// The Cloudflare Worker: serves the static Vite build (via the ASSETS binding) AND hosts the
// per-phrase global leaderboard API at /api/leaderboard, backed by D1. `run_worker_first: ["/api/*"]`
// in wrangler.jsonc ensures this handles the API (incl. POST) before the static-asset layer.
//
// Minimal binding types are declared inline to avoid a @cloudflare/workers-types dependency; wrangler
// injects the real D1Database / Fetcher at runtime. Typechecked via worker/tsconfig.json.
import { PHRASES } from "../src/phrases.ts";

interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database { prepare(query: string): D1PreparedStatement; }
interface Fetcher { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>; }
export interface Env { ASSETS: Fetcher; DB: D1Database; }

interface ScoreRow { initials: string; ms: number; }

const TOP_N = 10;
const isPhrase = (s: string): boolean => (PHRASES as readonly string[]).includes(s);
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const clampLimit = (v: unknown): number => Math.min(50, Math.max(1, Math.floor(Number(v)) || TOP_N));
// Match the client: 1–3 uppercase letters only (safe to render, no junk in the board).
const cleanInitials = (raw: unknown): string => String(raw ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);

// Fastest runs for ONE phrase (the per-phrase board), ascending by time.
async function topScores(env: Env, phrase: string, limit: number): Promise<ScoreRow[]> {
  const { results } = await env.DB
    .prepare("SELECT initials, ms FROM scores WHERE phrase = ? ORDER BY ms ASC LIMIT ?")
    .bind(phrase, limit)
    .all<ScoreRow>();
  return results;
}

async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const phrase = url.searchParams.get("phrase") ?? "";
    if (!isPhrase(phrase)) return json({ error: "unknown phrase" }, 400);
    return json({ scores: await topScores(env, phrase, clampLimit(url.searchParams.get("limit"))) });
  }

  if (request.method === "POST") {
    let body: { phrase?: unknown; initials?: unknown; ms?: unknown; limit?: unknown };
    try { body = (await request.json()) as typeof body; } catch { return json({ error: "bad json" }, 400); }
    const phrase = String(body.phrase ?? "");
    if (!isPhrase(phrase)) return json({ error: "unknown phrase" }, 400);
    const initials = cleanInitials(body.initials);
    const ms = Math.round(Number(body.ms));
    if (!initials || !Number.isFinite(ms) || ms <= 0 || ms > 3_600_000) return json({ error: "bad score" }, 400);
    await env.DB
      .prepare("INSERT INTO scores (phrase, initials, ms, created_at) VALUES (?, ?, ?, ?)")
      .bind(phrase, initials, ms, Date.now())
      .run();
    return json({ scores: await topScores(env, phrase, clampLimit(body.limit)) });
  }

  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/leaderboard") return handleLeaderboard(request, env);
    return env.ASSETS.fetch(request); // everything else = the static Vite build
  },
};
