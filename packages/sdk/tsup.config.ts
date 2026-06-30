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
  // Keep browser bundle lean – no Node built-ins
  platform: "browser",
  treeshake: true,
});
