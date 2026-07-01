// The germaphobe typing phrases — SHARED by the mini-game (keyboard.ts) and the leaderboard Worker
// (worker/index.ts). Keeping them in one place means the per-phrase leaderboard keys always match and
// the Worker can validate that a submitted score names a real phrase (rejects junk). Letters + spaces
// only, so the game never needs the symbols layer.
export const PHRASES = [
  "AIR KEYBOARD FOR GERMAPHOBES",
  "NOBODY ELSE TOUCHED THIS ONE",
  "WASH YOUR HANDS FIRST",
  "NO GERMS ON MY KEYBOARD",
  "PLEASE DO NOT TOUCH ANYTHING",
  "SANITIZE BEFORE YOU TYPE",
  "KEEP YOUR HANDS TO YOURSELF",
  "TYPING WITHOUT ALL THE TOUCHING",
] as const;

export type Phrase = (typeof PHRASES)[number];
export const isPhrase = (s: string): s is Phrase => (PHRASES as readonly string[]).includes(s);
