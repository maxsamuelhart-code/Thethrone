import { useEffect, useState } from "react";
import type { Pos, ProfileKey, SeedScore } from "@seedscout/engine";
import { pool } from "../engine/pool";
import type { World } from "../engine/protocol";

export function ScorePanel({ world, onGo }: { world: World; onGo(p: Pos): void }) {
  const [profile, setProfile] = useState<ProfileKey>("survival");
  const [score, setScore] = useState<SeedScore | null>(null);

  useEffect(() => {
    let live = true;
    setScore(null);
    pool.request("score", { world, profile }).then((s) => live && setScore(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [world, profile]);

  return (
    <div className="panel">
      <div className="segmented" role="tablist">
        {(["survival", "speedrun"] as const).map((p) => (
          <button key={p} role="tab" aria-selected={profile === p} onClick={() => setProfile(p)}>
            {p === "survival" ? "Survival" : "Speedrun"}
          </button>
        ))}
      </div>
      {!score ? (
        <p className="muted">Evaluating seed…</p>
      ) : (
        <>
          <div className="score-hero">
            <div className={`grade grade-${score.grade}`}>{score.grade}</div>
            <div>
              <div className="score-num">{score.score}<small>/100</small></div>
              <div>{score.verdict}</div>
            </div>
          </div>
          {score.highlights.length > 0 && (
            <ul className="highlights">
              {score.highlights.map((h) => <li key={h}>{h}</li>)}
            </ul>
          )}
          <ul className="breakdown">
            {score.breakdown.map((b) => (
              <li key={b.label}>
                <div className="row">
                  <span>{b.label}</span>
                  <span className="muted">{b.detail}</span>
                </div>
                <div className="bar"><span style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          <button className="btn ghost" onClick={() => onGo(score.spawn)}>Go to spawn ({score.spawn.x}, {score.spawn.z})</button>
        </>
      )}
    </div>
  );
}
