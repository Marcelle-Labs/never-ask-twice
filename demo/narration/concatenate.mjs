#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const narrationDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(narrationDir, "output");
const manifestPath = resolve(outputDir, "segments.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.segments?.length)
  throw new Error("No generated segments found. Run node demo/narration/generate.mjs first.");
const run = (args) => {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.slice(-1000)}`);
};
const probe = (file) => {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return Math.round(Number(result.stdout.trim()) * 1000);
};
const inputs = [];
const labels = [];
let inputIndex = 0;
for (const segment of manifest.segments) {
  inputs.push("-i", resolve(outputDir, segment.filename));
  labels.push(`[${inputIndex}:a]`);
  inputIndex += 1;
  if (segment.postRollMs > 0) {
    inputs.push("-f", "lavfi", "-t", String(segment.postRollMs / 1000), "-i", "anullsrc=r=44100:cl=mono");
    labels.push(`[${inputIndex}:a]`);
    inputIndex += 1;
  }
}
const filter = `${labels.join("")}concat=n=${labels.length}:v=0:a=1[a]`;
const wavPath = resolve(outputDir, "narration.wav");
const mp3Path = resolve(outputDir, "narration.mp3");
run(["-y", ...inputs, "-filter_complex", filter, "-map", "[a]", "-ar", "44100", "-ac", "1", wavPath]);
run(["-y", "-i", wavPath, "-codec:a", "libmp3lame", "-b:a", "192k", mp3Path]);
let cursorMs = 0;
const timing = manifest.segments.map((segment) => {
  const actualDurationMs = probe(resolve(outputDir, segment.filename));
  const entry = {
    ...segment,
    actualStartMs: cursorMs,
    actualDurationMs,
    actualEndMs: cursorMs + actualDurationMs,
    postRollMs: segment.postRollMs ?? 0,
  };
  cursorMs = entry.actualEndMs + entry.postRollMs;
  return entry;
});
const output = {
  version: 1,
  spokenWordCount: manifest.spokenWordCount,
  totalDurationMs: probe(mp3Path),
  spokenDurationMs: timing.reduce((sum, scene) => sum + scene.actualDurationMs, 0),
  wordsPerMinute: Number(
    (manifest.spokenWordCount / (timing.reduce((sum, scene) => sum + scene.actualDurationMs, 0) / 60000)).toFixed(1),
  ),
  files: { wav: "narration.wav", mp3: "narration.mp3" },
  sha256: {
    wav: createHash("sha256")
      .update(await readFile(wavPath))
      .digest("hex"),
    mp3: createHash("sha256")
      .update(await readFile(mp3Path))
      .digest("hex"),
  },
  scenes: timing,
};
// Devpost's hard limit is 3:00 for the final muxed video, not the narration
// track alone — leave headroom for intro/outro frames added in editing.
if (output.totalDurationMs > 165000) {
  throw new Error(`Narration is ${output.totalDurationMs}ms, above the 2:45 safety ceiling. Revise scenes and regenerate.`);
}
await writeFile(resolve(outputDir, "timing.manifest.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Wrote narration.wav, narration.mp3, and timing.manifest.json (${output.totalDurationMs}ms, ${output.wordsPerMinute} spoken WPM).`,
);
