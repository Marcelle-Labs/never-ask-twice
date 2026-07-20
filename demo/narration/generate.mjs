#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const narrationDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(narrationDir, "output");
const scenes = JSON.parse(await readFile(resolve(narrationDir, "scenes.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(narrationDir, "voice.example.json"), "utf8"));
const force = process.argv.includes("--force");
const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;

if (!apiKey || !voiceId) {
  console.error(
    "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required. Run via:\n" +
      "  ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node demo/narration/generate.mjs\n" +
      "No request was made and no credentials were printed.",
  );
  process.exit(2);
}

await mkdir(outputDir, { recursive: true });
const probeDurationMs = (file) => {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffprobe failed for ${file}: ${result.stderr.trim()}`);
  return Math.round(Number(result.stdout.trim()) * 1000);
};
const peakDb = (file) => {
  const result = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`ffmpeg peak inspection failed for ${file}: ${result.stderr.trim()}`);
  const match = result.stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!match) throw new Error(`ffmpeg did not report a peak level for ${file}`);
  return Number(match[1]);
};
const hashFile = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const segments = [];
for (const scene of scenes) {
  const filename = `${scene.id}.mp3`;
  const destination = resolve(outputDir, filename);
  let bytes;
  try {
    if (!force) bytes = await readFile(destination);
  } catch {}
  if (!bytes) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(config.outputFormat)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({
          text: scene.text,
          model_id: config.modelId,
          language_code: config.languageCode,
          voice_settings: config.voiceSettings,
        }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500).replaceAll(apiKey, "[REDACTED]");
      throw new Error(`ElevenLabs generation failed for ${scene.id}: HTTP ${response.status} ${detail}`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error(`ElevenLabs returned empty audio for ${scene.id}`);
    await writeFile(destination, bytes);
  }
  const durationMs = probeDurationMs(destination);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`Invalid audio duration for ${filename}`);
  const maxPeakDb = peakDb(destination);
  if (maxPeakDb >= 0) throw new Error(`Potentially clipped audio for ${filename}: ${maxPeakDb} dBFS`);
  segments.push({
    id: scene.id,
    filename,
    spokenText: scene.text,
    displayText: scene.displayText ?? scene.text,
    wordCount: scene.text.trim().split(/\s+/).length,
    durationMs,
    maxPeakDb,
    postRollMs: scene.postRollMs,
    sha256: await hashFile(destination),
  });
  console.log(`${filename}: ${durationMs}ms`);
}
const spokenWordCount = segments.reduce((total, segment) => total + segment.wordCount, 0);
await writeFile(
  resolve(outputDir, "segments.manifest.json"),
  `${JSON.stringify({ version: 1, provider: "ElevenLabs", voiceId, modelId: config.modelId, outputFormat: config.outputFormat, generatedAt: new Date().toISOString(), spokenWordCount, segments }, null, 2)}\n`,
);
console.log(
  `Wrote ${segments.length} segments and segments.manifest.json. Voice ID is retained only in this ignored output manifest.`,
);
