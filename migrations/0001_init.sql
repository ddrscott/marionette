-- Per-phrase leaderboard: one row per completed run. A phrase's board is ORDER BY ms ASC LIMIT N.
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY,
  phrase     TEXT    NOT NULL,
  initials   TEXT    NOT NULL,
  ms         INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- The hot query is "fastest times for this phrase", so index (phrase, ms).
CREATE INDEX IF NOT EXISTS idx_scores_phrase_ms ON scores (phrase, ms);
