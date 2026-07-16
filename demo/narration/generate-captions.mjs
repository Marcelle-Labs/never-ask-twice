#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const narrationDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(narrationDir, "output");
const timing = JSON.parse(await readFile(resolve(outputDir, "timing.manifest.json"), "utf8"));
const formatTime = (ms, separator) => {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milliseconds = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(milliseconds).padStart(3, "0")}`;
};
// Only treat .!? as a sentence end when followed by whitespace or end of
// string — protects decimals ("1.00") and bare domains ("github.com") from
// being mistaken for sentence boundaries.
function splitSentences(text) {
  const trimmed = text.trim();
  const sentences = [];
  let start = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "." || trimmed[i] === "!" || trimmed[i] === "?") {
      const next = trimmed[i + 1];
      if (next === undefined || /\s/.test(next)) {
        sentences.push(trimmed.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  if (start < trimmed.length) sentences.push(trimmed.slice(start).trim());
  return sentences.filter(Boolean);
}

const captions = [];
for (const scene of timing.scenes) {
  // Timing weights come from the spoken (phonetic) text — it matches the
  // audio. Caption text comes from displayText — natural spelling for
  // readability (e.g. "SLA" instead of "S L A"). Both must split into the
  // same number of sentences or they'd desync.
  const spokenSentences = splitSentences(scene.spokenText);
  const displaySentences = splitSentences(scene.displayText ?? scene.spokenText);
  if (displaySentences.length !== spokenSentences.length) {
    throw new Error(
      `Scene ${scene.id}: spokenText and displayText split into a different number of sentences (${spokenSentences.length} vs ${displaySentences.length}). Keep punctuation structure identical between the two.`,
    );
  }
  const weights = spokenSentences.map((sentence) => sentence.trim().split(/\s+/).length);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  let cursor = scene.actualStartMs;
  displaySentences.forEach((sentence, index) => {
    const duration =
      index === displaySentences.length - 1
        ? scene.actualEndMs - cursor
        : Math.round(scene.actualDurationMs * (weights[index] / weightTotal));
    captions.push({ startMs: cursor, endMs: cursor + duration, text: sentence.trim() });
    cursor += duration;
  });
}
const srt = captions
  .map(
    (caption, index) =>
      `${index + 1}\n${formatTime(caption.startMs, ",")} --> ${formatTime(caption.endMs, ",")}\n${caption.text}\n`,
  )
  .join("\n");
const vtt = `WEBVTT\n\n${captions.map((caption) => `${formatTime(caption.startMs, ".")} --> ${formatTime(caption.endMs, ".")}\n${caption.text}\n`).join("\n")}`;
await writeFile(resolve(outputDir, "narration.srt"), srt);
await writeFile(resolve(outputDir, "narration.vtt"), vtt);
console.log(
  `Wrote ${captions.length} sentence-level captions. Spoken captions end at ${formatTime(captions.at(-1).endMs, ".")}; track duration is ${formatTime(timing.totalDurationMs, ".")}.`,
);
