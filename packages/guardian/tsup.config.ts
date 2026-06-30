import { defineConfig } from "tsup";

export default defineConfig([
  // ── Browser SDK bundle ────────────────────────────────────────────────────
  {
    entry:      { index: "src/index.ts" },
    format:     ["cjs", "esm", "iife"],
    globalName: "FrontendGuardian",
    dts:        true,
    sourcemap:  true,
    clean:      true,
    minify:     true,
    target:     "es2018",
    platform:   "browser",
    treeshake:  true,
    // Bundle sdk + types into a single file for the browser
    noExternal: ["@frontend-guardian/sdk", "@frontend-guardian/types"],
  },

  // ── CLI bundle (Node.js, no minification for readability) ─────────────────
  {
    entry:    { cli: "src/cli/setup.ts" },
    format:   ["cjs"],
    dts:      false,
    sourcemap: false,
    clean:    false,          // don't wipe the browser build
    minify:   false,
    target:   "node18",
    platform: "node",
    banner:   { js: "#!/usr/bin/env node" },
    noExternal: [],           // all Node built-ins, no extra deps needed
  },
]);
