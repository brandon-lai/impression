/**
 * Bundle the library for `node --test`.
 *
 * The app is TypeScript with a `@/` alias and the test runner is plain Node, so
 * the library is bundled once into a single ESM file the tests import. Doing it
 * this way rather than with a loader keeps the tests running against exactly
 * the module graph the app builds.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";

mkdirSync("tests/.build", { recursive: true });

await build({
  entryPoints: ["tests/entry.ts"],
  outfile: "tests/.build/lib.mjs",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  alias: { "@": path.resolve("src") },
  external: ["node:*"],
});
console.error("built tests/.build/lib.mjs");
