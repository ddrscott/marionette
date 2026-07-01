// Hand-driven A–Z initials picker (finger-gun): the index fingertip is a cursor over a 9×3 A–Z+DEL
// grid; tucking the thumb "fires" to select the highlighted cell. `pushChar` lets a keyboard drive
// the SAME buffer, so hand + keyboard both work. Reused by /game (record break) and /keyboard (test).
import type { Landmark } from "./hands.ts";
import { handPointer } from "./gesture.ts";

const CELLS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "DEL"]; // 27 cells, row-major over 9 cols × 3 rows
const MARGIN = 0.14;                        // reachable margin mapping the hand range onto the grid
const THUMB_OPEN = 0.7, THUMB_TUCK = 0.5;   // thumb-openness hysteresis (extended vs tucked)
const FIRE_COOLDOWN_MS = 300;               // min gap between selects

export class HandInitials {
  buf = "";
  private cells: HTMLElement[];
  private thumbWasOpen = true;
  private lastFireT = -1e9;

  // `grid` gets the 27 cells appended before `cursor` (so the cursor stays on top). `onSubmit` fires
  // when the 3rd character is entered (buf is then cleared for the next entry).
  constructor(grid: HTMLElement, private cursor: HTMLElement, private onSubmit: (initials: string) => void) {
    this.cells = CELLS.map((ch) => {
      const c = document.createElement("div");
      c.className = "re-cell";
      c.textContent = ch;
      grid.insertBefore(c, cursor);
      return c;
    });
  }

  reset(): void { this.buf = ""; this.thumbWasOpen = true; this.hideCursor(); this.highlight(-1); }
  hideCursor(): void { this.cursor.style.opacity = "0"; }
  private highlight(idx: number): void { this.cells.forEach((c, i) => c.classList.toggle("on", i === idx)); }

  // Add a character from ANY source (keyboard or hand). "DEL" backspaces; the 3rd char auto-submits.
  pushChar(ch: string): void {
    if (ch === "DEL") { this.buf = this.buf.slice(0, -1); return; }
    if (this.buf.length < 3) {
      this.buf += ch;
      if (this.buf.length === 3) { this.onSubmit(this.buf); this.buf = ""; }
    }
  }

  // Feed one hand's landmarks each frame (null = no hand). Moves the cursor, highlights the pointed
  // cell, and fires a select on the thumb open->tuck edge.
  update(lm: Landmark[] | null, now: number): void {
    if (!lm) { this.hideCursor(); this.highlight(-1); return; }
    const p = handPointer(lm);
    const gx = Math.min(1, Math.max(0, (p.x - MARGIN) / (1 - 2 * MARGIN)));
    const gy = Math.min(1, Math.max(0, (p.y - MARGIN) / (1 - 2 * MARGIN)));
    const idx = Math.min(2, Math.floor(gy * 3)) * 9 + Math.min(8, Math.floor(gx * 9));

    this.cursor.style.opacity = "1";
    this.cursor.style.left = `${gx * 100}%`;
    this.cursor.style.top = `${gy * 100}%`;
    this.highlight(idx);

    // finger-gun trigger: thumb extended -> tucked = fire (hysteresis + cooldown)
    const open = p.thumbOpen > THUMB_OPEN ? true : p.thumbOpen < THUMB_TUCK ? false : this.thumbWasOpen;
    if (this.thumbWasOpen && !open && now - this.lastFireT > FIRE_COOLDOWN_MS) {
      this.lastFireT = now;
      this.pushChar(CELLS[idx]);
    }
    this.thumbWasOpen = open;
  }
}
