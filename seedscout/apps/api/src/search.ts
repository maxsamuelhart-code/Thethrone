/**
 * Search jobs. A job scans a deterministic stream of candidate seeds in batches;
 * each queue message runs one batch, stores matches, and re-enqueues the job
 * until it has enough matches, hits its seed budget, or is cancelled.
 *
 * Batches are bounded by seed count, not wall time: inside a Worker, Date.now()
 * does not advance during synchronous computation.
 */
import { searchBatch } from "@seedscout/engine";
import { LIMITS, type JobStatus, type SearchJob, type SearchRequest } from "@seedscout/shared";
import type { Env } from "./env";
import { getEngine } from "./engine";
import { newId, now, randomSeed } from "./util";

/** ~5-15 ms per seed for typical queries: a few thousand fits comfortably in one invocation. */
const SEEDS_PER_BATCH = 3000;

export class SearchLimitError extends Error {}

export async function createJob(env: Env, userId: string, req: SearchRequest): Promise<string> {
  const dayAgo = now() - 24 * 3600 * 1000;
  const counts = await env.DB.prepare(
    `SELECT SUM(created_at > ?) AS today, SUM(status IN ('queued','running')) AS active FROM search_jobs WHERE user_id = ?`,
  )
    .bind(dayAgo, userId)
    .first<{ today: number | null; active: number | null }>();
  if ((counts?.today ?? 0) >= LIMITS.pro.searchJobsPerDay) throw new SearchLimitError("Daily search limit reached");
  if ((counts?.active ?? 0) >= LIMITS.pro.concurrentJobs) throw new SearchLimitError("Too many searches running");

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO search_jobs (id, user_id, query, start_seed, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
  )
    .bind(id, userId, JSON.stringify(req), randomSeed(), now(), now())
    .run();
  await env.SEARCH_QUEUE.send({ jobId: id });
  return id;
}

interface JobRow {
  id: string;
  user_id: string;
  query: string;
  start_seed: string;
  cursor: number;
  status: JobStatus;
  error: string | null;
}

export async function getJob(env: Env, userId: string, id: string): Promise<SearchJob | null> {
  const row = await env.DB.prepare("SELECT * FROM search_jobs WHERE id = ? AND user_id = ?").bind(id, userId).first<JobRow>();
  if (!row) return null;
  const { results } = await env.DB.prepare("SELECT match FROM search_results WHERE job_id = ? LIMIT 100").bind(id).all<{ match: string }>();
  const q = JSON.parse(row.query) as SearchRequest;
  return {
    id: row.id,
    status: row.status,
    scanned: row.cursor,
    maxSeeds: q.maxSeeds,
    matches: results.map((r) => JSON.parse(r.match)),
    error: row.error,
  };
}

export async function cancelJob(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare("UPDATE search_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued','running')")
    .bind(now(), id, userId)
    .run();
}

/** Queue consumer: runs one batch of a job. */
export async function runBatch(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM search_jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job || (job.status !== "queued" && job.status !== "running")) return;
  const req = JSON.parse(job.query) as SearchRequest;

  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM search_results WHERE job_id = ?").bind(jobId).first<{ n: number }>();
  const engine = await getEngine();
  const limit = Math.min(SEEDS_PER_BATCH, req.maxSeeds - job.cursor);
  const batch = searchBatch(engine, req, BigInt(job.start_seed), job.cursor, limit, {
    maxMatches: req.wantMatches - (before?.n ?? 0),
  });

  const stmts = batch.matches.map((m) =>
    env.DB.prepare("INSERT INTO search_results (job_id, seed, match) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(jobId, m.seed, JSON.stringify(m)),
  );
  if (stmts.length) await env.DB.batch(stmts);
  const done = (before?.n ?? 0) + batch.matches.length >= req.wantMatches || batch.nextCursor >= req.maxSeeds;

  // Guarded on status so a cancel that landed mid-batch sticks.
  const updated = await env.DB.prepare(
    "UPDATE search_jobs SET cursor = ?, status = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running')",
  )
    .bind(batch.nextCursor, done ? "done" : "running", now(), jobId)
    .run();
  if (!done && updated.meta.changes) await env.SEARCH_QUEUE.send({ jobId });
}

export async function failJob(env: Env, jobId: string, error: string): Promise<void> {
  await env.DB.prepare("UPDATE search_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(error.slice(0, 500), now(), jobId).run();
}
