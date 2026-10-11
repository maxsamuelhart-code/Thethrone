/**
 * A small pool of engine workers. Map tiles are queued behind interactive
 * requests (score, structures) and can be cancelled when they scroll off-screen,
 * which keeps panning responsive on low-end phones.
 */
import type { RequestType, Requests, Responses, WorkerRequest, WorkerResponse } from "./protocol";

interface Job {
  id: number;
  type: RequestType;
  payload: unknown;
  key?: string;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

export class CancelledError extends Error {}

class EnginePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<number, Job>();
  private nextId = 1;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.finish(w, e.data);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  request<K extends RequestType>(type: K, payload: Requests[K], opts: { key?: string; background?: boolean } = {}): Promise<Responses[K]> {
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.nextId++, type, payload, key: opts.key, resolve: resolve as (v: unknown) => void, reject };
      if (opts.background) this.queue.push(job);
      else this.queue.unshift(job);
      this.pump();
    });
  }

  /** Drops queued (not yet started) jobs whose key matches. */
  cancel(match: (key: string) => boolean): void {
    this.queue = this.queue.filter((j) => {
      if (j.key && match(j.key)) {
        j.reject(new CancelledError());
        return false;
      }
      return true;
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(job.id, job);
      w.postMessage({ id: job.id, type: job.type, payload: job.payload } as WorkerRequest);
    }
  }

  private finish(w: Worker, res: WorkerResponse): void {
    const job = this.running.get(res.id);
    this.running.delete(res.id);
    this.idle.push(w);
    if (job) res.ok ? job.resolve(res.result) : job.reject(new Error(res.error));
    this.pump();
  }
}

export const pool = new EnginePool(Math.max(2, Math.min(navigator.hardwareConcurrency || 2, 6) - 1));
