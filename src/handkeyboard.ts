// A reusable hand-driven QWERTY keyboard. Uses the shared camera-input model (handCursor.ts): the
// palm centre is a cursor that maps LINEARLY onto the whole `field` (the stage/screen) — NOT scaled to
// fit the keyboard — and CLOSING your fist presses whatever key sits under it. So a key is where it
// looks: you move your hand to that spot on screen. DEL backspaces, OK submits. `pushChar` lets a
// physical keyboard drive the SAME buffer. Generic — any screen can mount it; /keyboard is its test
// bed; /game uses it (maxLen 3) for the record-break initials.
import type { Landmark } from "./hands.ts";
import { HandCursor } from "./handCursor.ts";

// QWERTY rows ending in the control keys. Laid out full-width; keys are hit-tested by their real
// on-screen rectangles, so differing key counts per row don't matter.
const ROWS: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", "DEL", "OK"],
];

export interface HandKeyboardOpts {
  maxLen?: number;                    // cap the buffer length (default: unbounded)
  onSubmit?: (text: string) => void;  // fired on OK; the buffer is then cleared
}

interface Cell { el: HTMLElement; r: number; c: number; }

export class HandKeyboard {
  buf = "";
  private rows: HTMLElement[][];
  private cells: Cell[] = [];
  private maxLen: number;
  private onSubmit?: (text: string) => void;
  private pointer = new HandCursor(); // palm-centre cursor + fist-to-press (shared with every scene)

  // `field` is the region the cursor maps onto (the visible stage/screen: #kbstage on /keyboard,
  // #stage on /game). `grid` hosts the QWERTY keys; `cursor` is the dot (positioned in screen space).
  constructor(private field: HTMLElement, grid: HTMLElement, private cursor: HTMLElement, opts: HandKeyboardOpts = {}) {
    this.maxLen = opts.maxLen ?? Infinity;
    this.onSubmit = opts.onSubmit;
    this.rows = ROWS.map((row, ri) => {
      const rowEl = document.createElement("div");
      rowEl.className = "re-row";
      const cells = row.map((ch, ci) => {
        const c = document.createElement("div");
        c.className = ch === "DEL" || ch === "OK" ? "re-cell re-ctrl" : "re-cell";
        c.textContent = ch;
        rowEl.appendChild(c);
        this.cells.push({ el: c, r: ri, c: ci });
        return c;
      });
      grid.insertBefore(rowEl, cursor);
      return cells;
    });
    // The cursor floats in SCREEN space (fixed) so it lands exactly where the hand points, over any key.
    this.cursor.style.position = "fixed";
    this.cursor.style.zIndex = "60";
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

  // Feed one hand's landmarks each frame (null = no hand). Maps the palm cursor LINEARLY onto the
  // field, positions it in screen space, highlights the key under it (by real rect), and presses on
  // the fist-close edge.
  update(lm: Landmark[] | null, now: number): void {
    const cs = this.pointer.read(lm, now);
    if (!cs.present) { this.hideCursor(); this.highlight(-1, -1); return; }
    const fr = this.field.getBoundingClientRect();
    const px = fr.left + cs.x * fr.width;   // screen-space cursor point (client px)
    const py = fr.top + cs.y * fr.height;

    this.cursor.style.opacity = "1";
    this.cursor.style.left = `${px}px`;
    this.cursor.style.top = `${py}px`;
    this.cursor.classList.toggle("closed", cs.closed);

    // hit-test the key under the cursor by its actual on-screen rectangle (no keyboard-space scaling)
    let hit: Cell | null = null;
    for (const cell of this.cells) {
      const b = cell.el.getBoundingClientRect();
      if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) { hit = cell; break; }
    }
    this.highlight(hit ? hit.r : -1, hit ? hit.c : -1);
    if (cs.clicked && hit) this.pushChar(ROWS[hit.r][hit.c]); // close the fist over a key to press it
  }
}
