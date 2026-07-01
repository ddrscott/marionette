// A reusable hand-driven QWERTY keyboard. Uses the shared camera-input model (handCursor.ts): the
// palm centre is a cursor that maps LINEARLY onto the whole `field` (the stage/screen) — NOT scaled to
// fit the keyboard — and CLOSING your fist presses whatever key sits under it. So a key is where it
// looks: you move your hand to that spot on screen. DEL backspaces, OK submits, SPACE inserts a space.
// A mobile-style layer toggle (?123 ⇄ ABC) swaps the letters view for a curated numbers/symbols view
// so pinch targets stay large. `pushChar` lets a physical keyboard drive the SAME buffer. Generic —
// any screen can mount it; /keyboard is its test bed; /game uses it (maxLen 3) for record initials.
import { HandCursor, CLICK_MIN_CONFIDENCE, type ClickGesture, type HandInput } from "./handCursor.ts";
import { pinchedFinger } from "./gesture.ts";
import { sfx } from "./sound.ts"; // shared audio bus — one click sample for every accepted key

// Two layouts, mobile-keyboard style. Keys are hit-tested by their real on-screen rectangles, so
// differing key counts per row don't matter. Special keys: DEL (backspace), OK (submit), SPACE (wide
// spacebar → " "), and the layer toggles "?123" (letters→symbols) / "ABC" (symbols→letters).
// The "" cell is a flexible SPACER (not a key), used to push OK far from SPACE so it isn't fat-fingered
// during typing. OK also needs a two-press confirm (see pushChar) since a stray press submits/clears.
const LETTERS: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["?123", "Z", "X", "C", "V", "B", "N", "M", "DEL"],
  ["", "SPACE", "", "OK"], // centered spacebar (balanced spacers), OK kept on the far right
];
const SYMBOLS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"], // each sits directly under its number (shift-row order)
  ["ABC", "-", "_", "+", "/", ":", ";", "'", "?", "DEL"],
  ["", "SPACE", "", "OK"],
];
const LAYOUTS = [LETTERS, SYMBOLS];

// Every symbol character on the numbers/symbols layer — exported so the physical-keyboard handlers
// (keyboard.ts, game.ts) route the SAME set into pushChar (parity, one buffer, DRY).
export const SYMBOL_CHARS = "!@#$%^&*()-_+/:;'?";

// Non-character keys never get appended verbatim: toggles switch the layer, SPACE inserts a space.
const isToggle = (k: string): boolean => k === "?123" || k === "ABC";
const isCtrl = (k: string): boolean => k === "DEL" || k === "OK" || isToggle(k);

export interface HandKeyboardOpts {
  maxLen?: number;                    // cap the buffer length (default: unbounded)
  onSubmit?: (text: string) => void;  // fired on the CONFIRMED (second) OK press; the buffer is then cleared
  click?: ClickGesture;               // "fist" (default) or "pinch" (finger-to-thumb) to press a key
}

interface Cell { el: HTMLElement; r: number; c: number; }

export class HandKeyboard {
  buf = "";
  private rows: HTMLElement[][];
  private cells: Cell[] = [];
  private maxLen: number;
  private onSubmit?: (text: string) => void;
  private okArmed = false;     // OK is a two-press confirm: first press arms ("OK?"), second submits
  private okTimer = 0;
  private pointer: HandCursor; // palm-centre cursor + fist/pinch-to-press (shared with every scene)
  private clickMode: ClickGesture;
  private prevDel = false;     // pinky-pinch (=DELETE) edge state, debounced separately from the press
  private lastDelT = -1e9;
  private layer = 0;           // 0 = letters, 1 = numbers/symbols (mobile-style ?123/ABC toggle)
  private pressTargets: HTMLElement[] = []; // extra DOM buttons the hand cursor can also hover + pinch-click
  locked = false;              // when true, KEYS don't type (hand/mouse/pinky-delete) — but registered
                               // buttons stay pressable. Lets a host freeze typing between rounds.

  // `field` is the region the cursor maps onto (the visible stage/screen: #kbstage on /keyboard,
  // #stage on /game). `grid` hosts the keys; `cursor` is the dot (positioned in screen space).
  constructor(private field: HTMLElement, private grid: HTMLElement, private cursor: HTMLElement, opts: HandKeyboardOpts = {}) {
    this.maxLen = opts.maxLen ?? Infinity;
    this.onSubmit = opts.onSubmit;
    this.clickMode = opts.click ?? "fist";
    this.pointer = new HandCursor({ click: opts.click });
    this.rows = [];
    this.buildLayer();
    // The cursor floats in SCREEN space (fixed) so it lands exactly where the hand points, over any key.
    this.cursor.style.position = "fixed";
    this.cursor.style.zIndex = "60";
    // Mouse/touch/pen is a THIRD input model alongside the hand cursor and the physical keyboard. One
    // delegated listener on the (persistent) grid survives buildLayer's per-toggle re-render, so we
    // don't re-bind per cell. pointerdown covers mouse+touch+pen and dodges the ~300ms click delay.
    this.grid.addEventListener("pointerdown", (e) => this.onPointerDown(e));
  }

  // Route a tap/click through the SAME press path as the hand. Find the tapped `.re-cell`, map it back
  // to its (r,c), and press it. preventDefault stops text selection, mobile double-tap zoom, and the
  // synthetic mouse-click that follows a touch (so a tap fires exactly once).
  private onPointerDown(e: PointerEvent): void {
    const cellEl = (e.target as HTMLElement | null)?.closest(".re-cell") as HTMLElement | null;
    if (!cellEl) return;
    const cell = this.cells.find((c) => c.el === cellEl);
    if (!cell) return;
    e.preventDefault();
    if (this.locked) return; // keys frozen between rounds (buttons handle their own DOM clicks)
    this.flashPressed(cellEl);
    this.press(LAYOUTS[this.layer][cell.r][cell.c]);
  }

  // Brief pressed-state feedback for a tap/click — a self-clearing class distinct from the hand's `.on`
  // highlight, so it never fights the per-frame highlight when a hand is also present.
  private flashPressed(el: HTMLElement): void {
    el.classList.add("pressed");
    window.setTimeout(() => el.classList.remove("pressed"), 140);
  }

  // The ONE shared press path for every input model (hand, mouse/touch, and — via pushChar — the
  // physical keyboard): toggles swap the layer (no char), SPACE inserts a space, everything else
  // (DEL/OK/char) goes to pushChar. Keeps the special-key semantics in a single place (DRY).
  private press(key: string): void {
    if (isToggle(key)) { sfx.key(); this.setLayer(this.layer === 0 ? 1 : 0); } // ?123 ⇄ ABC — clicks, never types
    else this.pushChar(key === "SPACE" ? " " : key);                           // SPACE → " "; DEL/OK/char as usual
  }

  // (Re)render the active layer's keys into the grid. Called on mount and on every layer toggle. The
  // cursor element stays as the grid's last child so hit-testing (rect-based) keeps working unchanged.
  private buildLayer(): void {
    this.grid.querySelectorAll(".re-row").forEach((el) => el.remove());
    this.cells = [];
    this.rows = LAYOUTS[this.layer].map((row, ri) => {
      const rowEl = document.createElement("div");
      rowEl.className = "re-row";
      const cells = row.map((ch, ci) => {
        const c = document.createElement("div");
        if (ch === "") { c.className = "re-gap"; rowEl.appendChild(c); return c; } // flexible spacer, not a key
        c.className = ch === "SPACE" ? "re-cell re-space" : isCtrl(ch) ? "re-cell re-ctrl" : "re-cell";
        c.textContent = ch === "SPACE" ? "space" : ch;
        rowEl.appendChild(c);
        this.cells.push({ el: c, r: ri, c: ci });
        return c;
      });
      this.grid.insertBefore(rowEl, this.cursor);
      return cells;
    });
  }

  private setLayer(n: number): void {
    if (n === this.layer) return;
    this.disarmOk();
    this.layer = n;
    this.buildLayer();
    this.highlight(-1, -1);
  }

  // OK confirmation: the first press ARMS (relabels the key "OK?"), the second within a short window
  // actually submits. Prevents a stray pinch from clearing the buffer / submitting.
  private okCell(): HTMLElement | undefined {
    return this.cells.find((c) => LAYOUTS[this.layer][c.r][c.c] === "OK")?.el;
  }
  private armOk(): void {
    this.okArmed = true;
    const el = this.okCell();
    if (el) { el.classList.add("armed"); el.textContent = "OK?"; }
    clearTimeout(this.okTimer);
    this.okTimer = window.setTimeout(() => this.disarmOk(), 2500);
  }
  private disarmOk(): void {
    if (!this.okArmed) return;
    this.okArmed = false;
    clearTimeout(this.okTimer);
    const el = this.okCell();
    if (el) { el.classList.remove("armed"); el.textContent = "OK"; }
  }

  reset(): void {
    this.buf = ""; this.prevDel = false; this.disarmOk();
    if (this.layer !== 0) { this.layer = 0; this.buildLayer(); } // back to letters on a fresh mount/use
    this.hideCursor(); this.highlight(-1, -1);
  }
  hideCursor(): void { this.cursor.style.opacity = "0"; this.cursor.classList.remove("closed"); }

  // Register an external button (outside the key grid) that the hand cursor can hover + pinch-click, so
  // screen buttons like the game's "next phrase" are reachable HANDS-FREE (mouse/touch already work via
  // the DOM). A hidden button (zero rect) is naturally skipped, so it's only live when shown.
  addPressTarget(el: HTMLElement): void { this.pressTargets.push(el); }
  private highlight(r: number, c: number): void {
    this.rows.forEach((row, ri) => row.forEach((cell, ci) => cell.classList.toggle("on", ri === r && ci === c)));
  }

  // Act on a key from ANY source (physical keyboard or the hand): DEL backspaces, OK submits, any
  // other value appends (up to maxLen).
  pushChar(ch: string): void {
    sfx.key(); // audible feedback on EVERY accepted key — both hand presses and physical typing
    if (ch !== "OK" && this.okArmed) this.disarmOk(); // any other key cancels a pending OK confirm
    if (ch === "DEL") this.buf = this.buf.slice(0, -1);
    else if (ch === "OK") {
      if (!this.okArmed) { this.armOk(); return; }    // first OK arms; needs a confirming second press
      this.disarmOk();
      this.onSubmit?.(this.buf); this.buf = "";
    }
    else if (this.buf.length < this.maxLen) this.buf += ch;
  }

  // Feed one hand's input each frame (null = no hand). Maps the palm cursor LINEARLY onto the field,
  // positions it in screen space, highlights the key under it (by real rect), and presses on the
  // click (fist-close or finger-thumb pinch) edge.
  update(hand: HandInput | null, now: number): void {
    const cs = this.pointer.read(hand, now);
    if (!cs.present || !hand) { this.hideCursor(); this.highlight(-1, -1); this.prevDel = false; return; }
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
    // Also let the cursor reach registered EXTERNAL buttons (e.g. the game's "next phrase") so the whole
    // flow is hands-free — checked only when no key is under the cursor. Hidden buttons have a zero rect.
    let hitBtn: HTMLElement | null = null;
    if (!hit) {
      for (const el of this.pressTargets) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) { hitBtn = el; break; }
      }
    }
    for (const el of this.pressTargets) el.classList.toggle("hand-hover", el === hitBtn);
    this.highlight(hit ? hit.r : -1, hit ? hit.c : -1);
    if (cs.clicked && hit && !this.locked) this.press(LAYOUTS[this.layer][hit.r][hit.c]); // pinch over a key = press (unless frozen)
    else if (cs.clicked && hitBtn) { sfx.key(); this.flashPressed(hitBtn); hitBtn.click(); } // pinch over a button = click it (always)

    // Pinky-to-thumb pinch = DELETE — a distinct gesture from the index/middle press, position-agnostic.
    // Pinch mode only (needs the 3D world skeleton); its own rising-edge + cooldown + confidence gate.
    if (this.clickMode === "pinch" && !this.locked) {
      const confident = hand.score === undefined || hand.score >= CLICK_MIN_CONFIDENCE;
      const del = confident && pinchedFinger(hand.world ?? hand.landmarks) === 20;
      if (del && !this.prevDel && now - this.lastDelT > 350) { this.pushChar("DEL"); this.lastDelT = now; }
      this.prevDel = del;
    }
  }
}
