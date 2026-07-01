// A reusable hand-driven QWERTY keyboard. Uses the shared camera-input model (handCursor.ts): the
// palm centre is a cursor over the QWERTY grid, and CLOSING your fist presses the pointed key. DEL
// backspaces, OK submits. `pushChar` lets a physical keyboard drive the SAME buffer. Generic — any
// screen can mount it; the buffer is plain text, and `maxLen` / `onSubmit` are the only per-use
// config. /keyboard is its test bed; /game uses it (maxLen 3) for the record-break initials.
import type { Landmark } from "./hands.ts";
import { HandCursor } from "./handCursor.ts";

// QWERTY rows ending in the control keys. Each row is laid out full-width, so a row's keys evenly
// divide the grid width and the cursor's gx maps onto them regardless of the differing key counts.
const ROWS: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", "DEL", "OK"],
];

export interface HandKeyboardOpts {
  maxLen?: number;                    // cap the buffer length (default: unbounded)
  onSubmit?: (text: string) => void;  // fired on OK; the buffer is then cleared
}

export class HandKeyboard {
  buf = "";
  private rows: HTMLElement[][];
  private maxLen: number;
  private onSubmit?: (text: string) => void;
  private pointer = new HandCursor(); // palm-centre cursor + fist-to-press (shared with every scene)

  // Mounts the QWERTY rows into `grid` (before `cursor`, so the cursor stays on top).
  constructor(grid: HTMLElement, private cursor: HTMLElement, opts: HandKeyboardOpts = {}) {
    this.maxLen = opts.maxLen ?? Infinity;
    this.onSubmit = opts.onSubmit;
    this.rows = ROWS.map((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "re-row";
      const cells = row.map((ch) => {
        const c = document.createElement("div");
        c.className = ch === "DEL" || ch === "OK" ? "re-cell re-ctrl" : "re-cell";
        c.textContent = ch;
        rowEl.appendChild(c);
        return c;
      });
      grid.insertBefore(rowEl, cursor);
      return cells;
    });
  }

  reset(): void { this.buf = ""; this.hideCursor(); this.highlight(-1, -1); }
  hideCursor(): void { this.cursor.style.opacity = "0"; this.cursor.classList.remove("closed"); }
  private highlight(r: number, c: number): void {
    this.rows.forEach((row, ri) => row.forEach((cell, ci) => cell.classList.toggle("on", ri === r && ci === c)));
  }

  // Act on a key from ANY source (physical keyboard or the hand): DEL backspaces, OK submits, any
  // other value appends (up to maxLen).
  pushChar(ch: string): void {
    if (ch === "DEL") this.buf = this.buf.slice(0, -1);
    else if (ch === "OK") { this.onSubmit?.(this.buf); this.buf = ""; }
    else if (this.buf.length < this.maxLen) this.buf += ch;
  }

  // Feed one hand's landmarks each frame (null = no hand). Moves the palm cursor, highlights the
  // pointed key, and presses it when the fist closes (open->closed edge).
  update(lm: Landmark[] | null, now: number): void {
    const cs = this.pointer.read(lm, now);
    if (!cs.present) { this.hideCursor(); this.highlight(-1, -1); return; }
    const gx = cs.x, gy = cs.y; // already [0,1], margin-applied
    const r = Math.min(ROWS.length - 1, Math.floor(gy * ROWS.length));
    const c = Math.min(ROWS[r].length - 1, Math.floor(gx * ROWS[r].length));

    this.cursor.style.opacity = "1";
    this.cursor.style.left = `${gx * 100}%`;
    this.cursor.style.top = `${gy * 100}%`;
    this.cursor.classList.toggle("closed", cs.closed);
    this.highlight(r, c);

    if (cs.clicked) this.pushChar(ROWS[r][c]); // close the fist over a key to press it
  }
}
