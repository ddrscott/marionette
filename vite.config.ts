import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Multi-page app: a landing page plus the two app pages. Each HTML file is its own entry point with
// its own module graph (the harness UI vs the game), but they share the engine + every src/ module.
const entry = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// CLASSIC worker, by design. MediaPipe's wasm loader calls `importScripts()`, which only exists in a
// classic (non-module) worker — a module worker dies at init with "ModuleFactory not set". The worker
// itself `importScripts` a vendored CJS bundle (no ESM import), so the same `{ type: "classic" }`
// spawn works in dev and build; `worker.format = "iife"` keeps the BUILT chunk a classic script.
export default defineConfig({
  // Allow the shared cloudflared dev-tunnel host (dev-<port>.dataturd.com) so the app can be reached
  // over HTTPS — needed for webcam access (getUserMedia) on phones / other devices, not just localhost.
  server: {
    allowedHosts: [".dataturd.com"],
  },
  worker: {
    format: "iife",
  },
  build: {
    rollupOptions: {
      input: {
        main: entry("./index.html"),
        harness: entry("./harness/index.html"),
        game: entry("./game/index.html"),
        pose: entry("./pose/index.html"),
        keyboard: entry("./keyboard/index.html"),
        characters: entry("./characters/index.html"),
      },
    },
  },
});
