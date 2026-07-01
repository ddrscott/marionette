// Shared "drag the camera preview anywhere" helper — mounted on #camBox in every camera scene
// (/game, /characters, /keyboard, and the harness). One code path, no per-scene duplication.
//
// - Pointer Events (pointerdown/move/up) cover BOTH mouse and touch; setPointerCapture keeps the drag
//   glued to the box even when the pointer leaves it. `touch-action: none` (set in CSS) stops a touch
//   drag from scrolling the page.
// - Placement is persisted NORMALIZED — the box's top-left as a fraction of the stage rect — under one
//   shared key (handbattle.cam.pos). A fraction (not raw px) survives window resizes AND the different
//   box sizes/positions each scene uses; on load we convert back to px and clamp.
// - Clamp keeps the WHOLE box inside both the stage (which clips via overflow:hidden) and the visible
//   viewport minus the mobile safe-area insets (env(safe-area-inset-*) — the notch / home-indicator).
//   Re-clamped on resize/orientation change so it can never end up off-screen or under a notch.

const DEFAULT_KEY = "handbattle.cam.pos";

// top-left as a fraction of the stage rect (0..1)
type Pos = { fx: number; fy: number };

function readSaved(key: string): Pos | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    if (typeof p?.fx === "number" && typeof p?.fy === "number") return { fx: p.fx, fy: p.fy };
  } catch { /* malformed / unavailable — fall back to the CSS default */ }
  return null;
}

function writeSaved(key: string, p: Pos): void {
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* quota / private mode */ }
}

// Resolve env(safe-area-inset-*) to px by reading a hidden probe's COMPUTED padding. (env() only
// resolves inside real CSS declarations, not when read back off a custom property.)
let probe: HTMLDivElement | null = null;
function safeInsets(): { top: number; right: number; bottom: number; left: number } {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
      "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

/**
 * Make the camera preview box free-draggable (mouse + touch), clamped fully on-screen, and persisted.
 * @param box   the #camBox element (contains the mirrored <video> + overlay canvas)
 * @param stageEl the positioned ancestor to clamp within (defaults to the box's offsetParent)
 * @param key   localStorage key for the shared position (defaults to handbattle.cam.pos)
 */
export function makeCamDraggable(
  box: HTMLElement,
  stageEl?: HTMLElement | null,
  key: string = DEFAULT_KEY,
): void {
  const stageRect = (): DOMRect =>
    (stageEl ?? (box.offsetParent as HTMLElement | null) ?? box.parentElement ?? document.body)
      .getBoundingClientRect();

  // Clamp a desired top-left (in viewport/client coords) so the whole box stays inside BOTH the stage
  // and the visible viewport minus the safe-area insets. Returns inline left/top relative to the stage.
  const clampToStage = (clientX: number, clientY: number): { left: number; top: number } => {
    const s = stageRect();
    const b = box.getBoundingClientRect();
    const ins = safeInsets();
    const regLeft = Math.max(s.left, ins.left);
    const regTop = Math.max(s.top, ins.top);
    const regRight = Math.min(s.right, window.innerWidth - ins.right);
    const regBottom = Math.min(s.bottom, window.innerHeight - ins.bottom);
    const maxX = Math.max(regLeft, regRight - b.width);
    const maxY = Math.max(regTop, regBottom - b.height);
    const cx = Math.min(Math.max(clientX, regLeft), maxX);
    const cy = Math.min(Math.max(clientY, regTop), maxY);
    return { left: cx - s.left, top: cy - s.top };
  };

  // Take over positioning: clear the scene's CSS anchoring (right/bottom/transform centering) so our
  // inline left/top win, then place the box. Opacity, border, mirror, size are untouched.
  const applyInline = (left: number, top: number): void => {
    box.style.right = "auto";
    box.style.bottom = "auto";
    box.style.transform = "none";
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  };

  // last placement we own, as a stage-fraction; null while the CSS default is still in charge
  let current: Pos | null = null;

  const applyNormalized = (p: Pos): void => {
    const s = stageRect();
    const { left, top } = clampToStage(s.left + p.fx * s.width, s.top + p.fy * s.height);
    applyInline(left, top);
    current = p;
  };

  const persistCurrent = (): void => {
    const s = stageRect();
    const b = box.getBoundingClientRect();
    const p: Pos = {
      fx: s.width > 0 ? (b.left - s.left) / s.width : 0,
      fy: s.height > 0 ? (b.top - s.top) / s.height : 0,
    };
    current = p;
    writeSaved(key, p);
  };

  // ---- drag (Pointer Events: mouse + touch + pen) ----
  let dragging = false;
  let grabDX = 0, grabDY = 0;

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return; // primary button only for mouse
    const b = box.getBoundingClientRect();
    grabDX = e.clientX - b.left;
    grabDY = e.clientY - b.top;
    dragging = true;
    box.classList.add("dragging");
    try { box.setPointerCapture(e.pointerId); } catch { /* capture unsupported — still works */ }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const { left, top } = clampToStage(e.clientX - grabDX, e.clientY - grabDY);
    applyInline(left, top);
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    box.classList.remove("dragging");
    try { box.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    persistCurrent();
  };

  box.addEventListener("pointerdown", onDown);
  box.addEventListener("pointermove", onMove);
  box.addEventListener("pointerup", onUp);
  box.addEventListener("pointercancel", onUp);

  // Restore a saved placement once layout is measurable; otherwise leave the CSS default in place.
  const saved = readSaved(key);
  if (saved) requestAnimationFrame(() => applyNormalized(saved));

  // Keep it on-screen through resizes / orientation changes (only once we own the position).
  addEventListener("resize", () => { if (current) applyNormalized(current); });
}
