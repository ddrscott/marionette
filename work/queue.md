# Work Queue

- [x] Control bar can pitch/roll/yaw to match hand orientation (physical via strings, ortho-simulated) — see [control-bar-pitch.md](control-bar-pitch.md)
- [x] Taut center string; loose limb strings as bezier curves — see [loose-string-beziers.md](loose-string-beziers.md)
- [x] Direct hand→cross mapping (2 measured points) + cut control-path latency — see [direct-cross-mapping.md](direct-cross-mapping.md)
- [x] Make the strings heavier (read as chains, not floaty thread) — see [heavier-strings.md](heavier-strings.md)
- [x] Strings collide with the floor, still pass through the puppet — see [strings-hit-floor.md](strings-hit-floor.md)
- [x] Two players from one camera (handedness-correct, no string crossing) — see [two-player-handedness.md](two-player-handedness.md)
- [x] Finger control points can't go below the floor (top/left/right free) — see [clamp-fingers-floor.md](clamp-fingers-floor.md)
- [x] Camera source + quality pickers (persisted sidebar dropdowns) — see [camera-picker.md](camera-picker.md)
- [x] Play-area margin (inset camera→play, overshoot offscreen; sidebar slider, default 10%, all sides) — see [play-area-margin.md](play-area-margin.md)
- [x] Off-thread hand detection — CLASSIC web worker, async/best-effort (profiled: detection = 24.6ms) — see [hands-web-worker.md](hands-web-worker.md)
