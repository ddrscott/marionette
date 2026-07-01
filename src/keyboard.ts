// /keyboard — "Air Keyboard for Germaphobes": a timed typing mini-game on the shared hand keyboard
// (src/handkeyboard.ts). Type the on-screen phrase IN THE AIR — the PHYSICAL keyboard is intentionally
// disabled, only the camera keyboard works. The timer starts when a hand enters frame (after a 3·2·1
// countdown) and stops on an exact match; then you enter 3 initials (again, in the air) and the run is
// posted to a PER-PHRASE global leaderboard (Cloudflare Worker + D1, see worker/index.ts).
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import type { WorkerHand } from "./hands.ts";
import { drawHands, TEAM_TEAL } from "./draw.ts";
import { HandKeyboard } from "./handkeyboard.ts";
import { makeCamDraggable } from "./dragCam.ts";
import { ICON_FS_MAX, ICON_FS_MIN } from "./icons.ts";
import { unlock, setMuted, sfx } from "./sound.ts";
import { PHRASES } from "./phrases.ts";
import { submitScore, type Score } from "./leaderboard.ts";

const LS_MUTED = "handbattle.audio.muted";
const LS_BEST = "handbattle.kb.bestMs";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;
const result = $("kbResult");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

function sizeOverlay(): void { camOverlay.width = camOverlay.clientWidth; camOverlay.height = camOverlay.clientHeight; }

// Initials are user text that lands in innerHTML (ours + other players' from the DB), so hard-restrict
// to 1–3 uppercase letters. The Worker sanitises the same way; this keeps the client render safe too.
const cleanInitials = (raw: string): string => raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "AAA";

(async function main() {
  try {
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;
    const hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });

    // Mount the shared keyboard with the finger-to-thumb PINCH click. OK submits initials (initials
    // phase only); CLEAR wipes the current entry — during a round that redoes the phrase, during
    // initials it just clears the initials.
    const kb = new HandKeyboard($("kbstage"), $("kbGrid"), $("kbCursor"), {
      click: "pinch",
      onSubmit: (text) => { if (phase === "initials") void submit(text); }, // confirmed OK submits initials
    });

    // ---- state machine ---------------------------------------------------------------------------
    // waiting → (hand enters) countdown → (3·2·1) running → (exact match) initials → (submit) done.
    // running → (hand leaves) paused → [resume · reset · new]. Typing is LOCKED except while running or
    // entering initials, so the other phases can't corrupt the buffer (buttons stay live).
    const COUNTDOWN_MS = 3000;   // 3·2·1 before the clock starts
    const GRACE_MS = 500;        // a hand must be gone this long to pause (rides out detection flicker)
    const WRONG_FLASH_MS = 400;  // how long the expected char flashes red after a rejected keypress
    const kbPrompt = $("kbPrompt");
    const kbTimer = $("kbTimer");
    const kbHint = $("kbHint");
    const kbBoard = $("kbBoard");
    const kbResume = $<HTMLButtonElement>("kbResume");
    const kbReset = $<HTMLButtonElement>("kbReset");
    const kbNew = $<HTMLButtonElement>("kbNew");
    const kbSubmit = $<HTMLButtonElement>("kbSubmit");
    type Phase = "waiting" | "countdown" | "running" | "paused" | "initials" | "done";
    let phase: Phase = "waiting";
    let prompt = "";
    let startMs = 0;           // wall-clock the attempt started (shifted on resume so elapsed continues)
    let countdownStart = 0;
    let pausedElapsed = 0;     // ms elapsed at pause, so resume continues instead of restarting
    let lastSeenMs = -1e9;     // last frame a hand was present (grace debounce for enter/exit)
    let howtoOpen = true;      // the how-to overlay gates the countdown until dismissed (once per load)
    let wrongUntil = 0;        // wall-clock until which the expected char shows red (a rejected keypress)
    let lastTick = 0;          // last countdown number spoken, so each of 3·2·1 beeps exactly once
    let lastMs = 0;            // the finished run's time, carried into initials + the leaderboard POST
    let bestMs = Number(localStorage.getItem(LS_BEST)) || 0; // personal best (local); 0 = none

    const setButtons = (resume: boolean, reset: boolean, neu: boolean, submitBtn: boolean): void => {
      kbResume.hidden = !resume; kbReset.hidden = !reset; kbNew.hidden = !neu; kbSubmit.hidden = !submitBtn;
    };

    // Prompt with the correctly-typed prefix in accent, the next char underlined, the rest dim. Wrong
    // keys aren't registered (see the running case) — instead the expected char FLASHES red (`flashWrong`)
    // so they just retype the right one. A space slot gets `.p-space` so "you need a space here" reads
    // clearly. Prompt is a fixed constant (A–Z + space) so it's safe in innerHTML.
    const renderPrompt = (flashWrong = false): void => {
      const typed = kb.buf.toUpperCase();
      let i = 0;
      while (i < typed.length && i < prompt.length && typed[i] === prompt[i]) i++;
      const cur = prompt.charAt(i);
      const curClass = "p-cur" + (cur === " " ? " p-space" : "") + (flashWrong ? " p-err" : "");
      kbPrompt.innerHTML =
        `<span class="p-done">${prompt.slice(0, i)}</span>` +
        `<span class="${curClass}">${cur === " " ? "&nbsp;" : cur || ""}</span>` +
        `<span class="p-rest">${prompt.slice(i + 1)}</span>`;
    };

    // Big 3-slot initials display so each typed letter clearly pops; empty slots show as underscores.
    // `kb.buf` is kept to A–Z (see the initials case), so it's safe in innerHTML.
    const renderInitials = (): void => {
      const ini = kb.buf.toUpperCase().slice(0, 3);
      let slots = "";
      for (let s = 0; s < 3; s++) {
        const ch = ini[s];
        slots += `<span class="ini-slot${ch ? " filled" : ""}">${ch ?? "_"}</span>`;
      }
      kbPrompt.innerHTML = `<span class="ini-slots">${slots}</span>`;
    };

    // Render one phrase's leaderboard, highlighting the just-submitted run. DB initials are Worker-
    // sanitised to [A-Z]{1,3}, so innerHTML is safe.
    const renderBoard = (scores: Score[], mine: { initials: string; ms: number } | null): void => {
      if (!scores.length) { kbBoard.innerHTML = `<div class="lb-empty">no times yet — you're first!</div>`; return; }
      let flagged = false;
      kbBoard.innerHTML = `<div class="lb-head">fastest · this phrase</div>` + scores.map((s, i) => {
        const isMe = !flagged && !!mine && s.initials === mine.initials && s.ms === mine.ms;
        if (isMe) flagged = true;
        return `<div class="lb-row${isMe ? " me" : ""}"><span class="lb-rank">${i + 1}</span>`
          + `<span class="lb-ini">${s.initials}</span><span class="lb-t">${(s.ms / 1000).toFixed(2)}s</span></div>`;
      }).join("");
    };

    // Arm a fresh attempt of the CURRENT `prompt` → waiting. Countdown begins once a hand appears.
    const toWaiting = (): void => {
      kb.reset();
      phase = "waiting";
      startMs = 0; pausedElapsed = 0; wrongUntil = 0;
      kbTimer.textContent = "0.0s";
      result.textContent = "";
      kbBoard.hidden = true;
      setButtons(false, false, false, false);
      kbHint.textContent = "raise your hand to start · pinch each letter to type"; // literal ·, NOT &middot; — textContent doesn't decode entities
      renderPrompt();
    };

    // NEW — pick a different phrase, then arm it. RESET / CLEAR — redo the SAME phrase. Both re-count-down.
    const newRound = (): void => {
      let p = prompt;
      while (p === prompt && PHRASES.length > 1) p = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      prompt = p || PHRASES[0];
      toWaiting();
    };
    const resetRound = (): void => { toWaiting(); };

    // RESUME — continue a paused attempt: shift startMs so elapsed carries on, keep the buffer.
    const resume = (): void => {
      if (phase !== "paused") return;
      phase = "running";
      startMs = performance.now() - pausedElapsed;
      setButtons(false, false, false, false);
      kbHint.textContent = "type the phrase";
    };

    // Exact match → initials entry (every run). Records a local personal best too.
    const finishRound = (now: number): void => {
      lastMs = now - startMs;
      const secs = lastMs / 1000;
      const wpm = secs > 0 ? Math.round((prompt.length / 5) / (secs / 60)) : 0;
      const isBest = bestMs === 0 || lastMs < bestMs;
      if (isBest) { bestMs = lastMs; localStorage.setItem(LS_BEST, String(Math.round(lastMs))); }
      phase = "initials";
      kb.reset(); // clear the phrase buffer so they can type initials
      kbTimer.textContent = `${secs.toFixed(2)}s`;
      result.innerHTML = `${secs.toFixed(2)}s · ${wpm} WPM`
        + (isBest ? ` · <span class="best">NEW PERSONAL BEST</span>` : "");
      setButtons(false, false, true, true); // new (skip) + submit
      kbHint.textContent = "enter your initials — pinch 3 letters, then SUBMIT";
      renderInitials(); // show the empty slots right away
      sfx.win();
    };

    // Post the run to the phrase's global board, then show it. Offline (no Worker) → graceful note.
    const submit = async (raw?: string): Promise<void> => {
      if (phase !== "initials") return;
      const initials = cleanInitials(raw ?? kb.buf);
      const ms = lastMs;
      kb.reset();
      phase = "done";
      kbBoard.hidden = false;
      kbBoard.innerHTML = `<div class="lb-empty">submitting…</div>`;
      setButtons(false, true, true, false); // reset · new
      kbHint.textContent = "reset to redo · new phrase for another";
      result.innerHTML = `you: <span class="best">${initials}</span> · ${(ms / 1000).toFixed(2)}s`;
      try {
        const scores = await submitScore(prompt, initials, ms);
        renderBoard(scores, { initials, ms });
      } catch {
        kbBoard.innerHTML = `<div class="lb-empty">leaderboard offline — not saved</div>`;
      }
    };

    // Per-frame state machine. `present` uses a grace window so a one-frame dropout doesn't pause.
    const gameUpdate = (hand: WorkerHand | null, now: number): void => {
      if (hand) lastSeenMs = now;
      const present = now - lastSeenMs < GRACE_MS;
      switch (phase) {
        case "waiting":
          // The how-to overlay gates the start; dismissing it (a pinch — so the hand is already in
          // view) drops the gate and the countdown kicks off right here on the next frame.
          if (present && !howtoOpen) { phase = "countdown"; countdownStart = now; lastTick = 0; kbHint.textContent = "get ready — pinch each letter to type"; }
          break;
        case "countdown": {
          if (!present) { toWaiting(); break; }               // hand left before GO — cancel the countdown
          const remain = COUNTDOWN_MS - (now - countdownStart);
          if (remain <= 0) {
            phase = "running"; startMs = now; kbTimer.textContent = "0.0s"; kbHint.textContent = "pinch each letter to type";
            sfx.go(); // audible "GO" so they don't have to watch the timer
          } else {
            const n = Math.ceil(remain / 1000); // 3 · 2 · 1
            kbTimer.textContent = String(n);
            if (n !== lastTick) { lastTick = n; sfx.count(n); } // one rising tick per number
          }
          break;
        }
        case "running": {
          if (!present) { phase = "paused"; pausedElapsed = now - startMs; setButtons(true, true, true, false); kbHint.textContent = "paused — hand left the frame"; break; }
          // Wrong keys DON'T register: keep only the correct prefix and flash the expected char red.
          const typed = kb.buf.toUpperCase();
          let i = 0;
          while (i < typed.length && i < prompt.length && typed[i] === prompt[i]) i++;
          if (typed.length > i) { kb.buf = prompt.slice(0, i); wrongUntil = now + WRONG_FLASH_MS; }
          kbTimer.textContent = `${((now - startMs) / 1000).toFixed(1)}s`;
          if (prompt.length > 0 && i === prompt.length) finishRound(now);
          break;
        }
        case "initials": {
          const clean = kb.buf.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3); // letters only, max 3
          if (clean !== kb.buf) kb.buf = clean;
          break;
        }
        case "paused":
        case "done":
          break; // buttons drive these
      }
      kb.locked = !(phase === "running" || phase === "initials"); // keys live only when typing
      if (phase === "initials") renderInitials();
      else if (phase !== "done") renderPrompt(now < wrongUntil);
    };

    kbResume.addEventListener("click", resume);
    kbReset.addEventListener("click", resetRound);
    kbNew.addEventListener("click", newRound);
    kbSubmit.addEventListener("click", () => void submit());
    // How-to overlay: dismiss by click, tap, or hand-PINCH on the button (a registered press target —
    // pressable even while the keys are locked). Once gone, the waiting case starts the countdown.
    const kbHowto = $("kbHowto");
    const kbGotIt = $<HTMLButtonElement>("kbGotIt");
    kbGotIt.addEventListener("click", () => { kbHowto.hidden = true; howtoOpen = false; });
    for (const b of [kbResume, kbReset, kbNew, kbSubmit, kbGotIt]) kb.addPressTarget(b); // hand-pinchable too
    newRound();

    // WebAudio autoplay policy: a webcam pinch is NOT a gesture, so the click can't play until a real
    // user gesture. The PHYSICAL keyboard is disabled for the game, so audio unlocks on the first
    // pointerdown (tap/click) only. Honor the saved global mute.
    setMuted(localStorage.getItem(LS_MUTED) === "1");
    const doUnlock = (): void => { unlock(); removeEventListener("pointerdown", doUnlock); };
    addEventListener("pointerdown", doUnlock);

    sizeOverlay();
    addEventListener("resize", sizeOverlay);
    new ResizeObserver(sizeOverlay).observe(camOverlay); // fit on mount without a manual resize
    makeCamDraggable($("camBox"), $("kbstage")); // drag the self-view anywhere; clamped + persisted

    // Fullscreen toggle (Fullscreen API) — same as /game; icon reflects state, stays synced on Esc-out.
    const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
    if (fsBtn) {
      const reflectFs = (): void => { fsBtn.innerHTML = document.fullscreenElement ? ICON_FS_MIN : ICON_FS_MAX; };
      reflectFs();
      document.addEventListener("fullscreenchange", reflectFs);
      fsBtn.addEventListener("click", () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      });
    }

    $("boot").remove();

    const loop = (): void => {
      const now = performance.now();
      hands.pump(now);
      const d = hands.latest[0] ?? null; // first detected hand drives the cursor (carries world + score)
      kb.update(d, now);  // world landmarks + score drive the x/y pinch
      gameUpdate(d, now); // timer, countdown/pause, exact-match → initials

      drawHands(overlayCtx, camOverlay.width, camOverlay.height, [d ? d.landmarks : null], [TEAM_TEAL]);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost and use Chrome.</pre>`;
  }
})();
