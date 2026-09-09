/**
 * Bundle the AudioWorklet.
 *
 * AudioWorkletGlobalScope has no module resolution, so the worklet has to be a
 * single self-contained file. It is generated from the same TypeScript the app
 * imports -- rather than being maintained as a parallel copy -- so the live
 * path and the future upload path cannot drift apart.
 *
 * Runs as `prebuild`, and the output is committed so a build without it still
 * works.
 */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("public/worklet", { recursive: true });

await build({
  entryPoints: ["src/lib/audio/worklet-entry.ts"],
  outfile: "public/worklet/features.worklet.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
});

console.error("built public/worklet/features.worklet.js");
