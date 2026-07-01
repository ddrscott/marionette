// The /game match state machine — a traditional fighting-game flow on top of the engine + the cut
// rules. One Match instance owns the whole lifecycle:
//
//   prematch  -> raise a hand to start (resets the score)
//   roundStart-> "ROUND N", both players calibrate (bring their puppets alive); fight begins when both
//                are running and the intro has shown briefly
//   fight     -> 99s timer; cut/ground-out rules live. Ends on a K.O. (a puppet down) or TIME (most
//                strings left wins)
//   roundEnd  -> announce the result, bank the round win, let the loser collapse, then next round
//   matchEnd  -> first to 3 round wins (best of 5) takes the match; drop hands to play again
//
// Power for the HUD bars = a puppet's INTACT strings (cut strings drain it).
import type { Stage } from "./engine.ts";
import type { Puppet } from "./puppet.ts";
import { updateRules, makeRulesState, type RulesState, type CutEvents } from "./cut.ts";

export type GamePhase = "prematch" | "roundStart" | "fight" | "roundEnd" | "matchEnd";

export const ROUND_TIME = 99;     // seconds per round
export const WINS_NEEDED = 3;     // best of 5 -> first to 3
export const MAX_STRINGS = 5;     // full power bar
const INTRO_MIN_MS = 1300;        // min time "ROUND N" shows before the fight can start
const FIGHT_FLASH_MS = 900;       // "FIGHT!" flash at the start of a round
const ROUNDEND_MS = 2800;         // pause after a round (let the loser collapse)
const RESTART_HOLD_MS = 1500;     // at match end, hands-off this long before a new match can start

const intact = (p: Puppet): number => p.strings.reduce((n, s) => n + (s.cutJoint === null ? 1 : 0), 0);

export class Match {
  phase: GamePhase = "prematch";
  round = 1;
  wins: [number, number] = [0, 0];
  timeLeft = ROUND_TIME;
  power: [number, number] = [MAX_STRINGS, MAX_STRINGS];
  announce = "";
  sub = "";
  roundWinner: 0 | 1 | null = null;
  matchWinner: 0 | 1 | null = null;

  // Optional slice/clash hooks the game wires to SFX; forwarded to the cut rules. Left unset in the
  // harness (which never constructs a Match) — the audio layer is game-only.
  cutEvents?: CutEvents;

  private rules: RulesState = makeRulesState();
  private phaseT = 0;  // performance.now() when the current phase began
  private fightT0 = 0; // when the current fight started

  private go(phase: GamePhase, now: number): void { this.phase = phase; this.phaseT = now; }
  private bothRunning(s: Stage): boolean { return s.slotStates[0].phase === "running" && s.slotStates[1].phase === "running"; }
  // "down" = killed by a cut/ground-out, OR no longer running (hand left, puppet fell) during a fight.
  private isDown(s: Stage, i: 0 | 1): boolean { return this.rules.dead[i] || s.slotStates[i].phase !== "running"; }
  private resetRound(s: Stage): void { s.resetToWaiting(0); s.resetToWaiting(1); this.rules = makeRulesState(); }

  update(stage: Stage, now: number): void {
    if (this.phaseT === 0) this.phaseT = now;
    this.power = [intact(stage.puppets[0]), intact(stage.puppets[1])];

    switch (this.phase) {
      case "prematch":
        this.announce = "MARIONETTE FIGHTER";
        this.sub = "raise your hands to begin";
        if (stage.handCount >= 1) {
          this.wins = [0, 0]; this.round = 1; this.matchWinner = null; this.roundWinner = null;
          this.resetRound(stage);
          this.go("roundStart", now);
        }
        break;

      case "roundStart":
        this.announce = `ROUND ${this.round}`;
        this.sub = this.bothRunning(stage) ? "" : "bring your puppets alive — raise a hand and hold";
        this.timeLeft = ROUND_TIME;
        if (this.bothRunning(stage) && now - this.phaseT >= INTRO_MIN_MS) {
          this.fightT0 = now;
          this.go("fight", now);
        }
        break;

      case "fight": {
        this.announce = now - this.fightT0 < FIGHT_FLASH_MS ? "FIGHT!" : "";
        this.sub = "";
        this.timeLeft = Math.max(0, ROUND_TIME - (now - this.fightT0) / 1000);
        updateRules(stage, this.rules, now, this.cutEvents);

        const d0 = this.isDown(stage, 0), d1 = this.isDown(stage, 1);
        if (d0 || d1) {
          this.roundWinner = d0 && d1 ? null : d0 ? 1 : 0;
          this.endRound(now, "K.O.");
        } else if (this.timeLeft <= 0) {
          this.roundWinner = this.power[0] === this.power[1] ? null : this.power[0] > this.power[1] ? 0 : 1;
          this.endRound(now, "TIME");
        }
        break;
      }

      case "roundEnd":
        // announce was set in endRound; just hold while the loser collapses (no rules running)
        if (now - this.phaseT >= ROUNDEND_MS) {
          if (this.wins[0] >= WINS_NEEDED || this.wins[1] >= WINS_NEEDED) {
            this.matchWinner = this.wins[0] >= WINS_NEEDED ? 0 : 1;
            this.go("matchEnd", now);
          } else {
            this.round++;
            this.resetRound(stage);
            this.go("roundStart", now);
          }
        }
        break;

      case "matchEnd":
        this.announce = this.matchWinner === 0 ? "PLAYER 1 WINS" : "PLAYER 2 WINS";
        this.sub = "drop your hands to play again";
        if (stage.handCount === 0 && now - this.phaseT > RESTART_HOLD_MS) {
          this.resetRound(stage);
          this.go("prematch", now);
        }
        break;
    }
  }

  private endRound(now: number, how: string): void {
    if (this.roundWinner !== null) this.wins[this.roundWinner]++;
    this.announce = this.roundWinner === null
      ? `${how} — DRAW`
      : `${how} — ${this.roundWinner === 0 ? "PLAYER 1" : "PLAYER 2"}`;
    this.sub = "";
    this.go("roundEnd", now);
  }
}
