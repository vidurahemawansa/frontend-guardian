import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm", "iife"],
  globalName: "FrontendGuardian",
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2018",
  platform: "browser",
  treeshake: true,
  // Bundle sdk + types so users get everything in one file
  noExternal: ["@frontend-guardian/sdk", "@frontend-guardian/types"],
});
