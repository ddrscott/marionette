// Client for the per-phrase global leaderboard served by the Cloudflare Worker (worker/index.ts) at
// /api/leaderboard. Each phrase has its OWN top-N board (keyed by the exact phrase string), so we track
// the fastest typist per specific phrase. Under `vite dev` there's no Worker, so these throw — callers
// treat that as "leaderboard offline" and degrade gracefully. Test the real API with `wrangler dev`.
export interface Score { initials: string; ms: number; }

const API = "/api/leaderboard";

// Top scores for ONE phrase, fastest first.
export async function fetchBoard(phrase: string, limit = 10): Promise<Score[]> {
  const res = await fetch(`${API}?phrase=${encodeURIComponent(phrase)}&limit=${limit}`);
  if (!res.ok) throw new Error(`board ${res.status}`);
  const data = (await res.json()) as { scores?: Score[] };
  return data.scores ?? [];
}

// Submit a run and get back that phrase's updated top-N.
export async function submitScore(phrase: string, initials: string, ms: number, limit = 10): Promise<Score[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phrase, initials, ms, limit }),
  });
  if (!res.ok) throw new Error(`submit ${res.status}`);
  const data = (await res.json()) as { scores?: Score[] };
  return data.scores ?? [];
}
