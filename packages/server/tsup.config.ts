import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "node",
  target: "node18",
  // Treat all node_modules as external
  noExternal: [],
  external: [],
  bundle: true,
});
