#!/usr/bin/env node
// Assemble the final demo video from Playwright capture + ElevenLabs narration.
//
// Inputs:
//   video/capture.webm   — Playwright recording (full run, 1920x1080)
//   audio/N1.mp3..N9.mp3 — per-segment narration
//   audio/durations.json — actual segment durations from render_audio.mjs
//   checkpoints.json     — per-checkpoint start timestamps (ms) from the
//                          Playwright run (written by a console listener or
//                          manually extracted from the [CHECKPOINT] log lines)
//
// Output:
//   never-ask-twice-demo.mp4 — 1080p, -16 LUFS, 0.3s crossfades, <= 3:00
//
// Usage:
//   node assemble.mjs
//
// If checkpoints.json is missing, the script falls back to equal slicing
// based on audio durations (each clip = its narration length + 1s pad).
// This is less precise but produces a watchable cut for dry runs.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const videoDir = path.join(__dirname, "video");
const audioDir = path.join(__dirname, "audio");
const outputDir = path.join(__dirname, "output");
fs.mkdirSync(outputDir, { recursive: true });

const SEGMENTS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9"];
const CHECKPOINTS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7a", "P7b", "P8", "P9"];

// --- Load durations ---
const durationsPath = path.join(audioDir, "durations.json");
let durations = {};
if (fs.existsSync(durationsPath)) {
  durations = JSON.parse(fs.readFileSync(durationsPath, "utf8"));
} else {
  // Fallback: probe each mp3 directly
  for (const id of SEGMENTS) {
    const file = path.join(audioDir, `${id}.mp3`);
    if (!fs.existsSync(file)) continue;
    try {
      const out = execSync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${file}"`,
        { encoding: "utf8", timeout: 10_000 },
      ).trim();
      durations[id] = parseFloat(out);
    } catch {
      durations[id] = null;
    }
  }
}

// --- Load checkpoint timestamps (ms) ---
const checkpointsPath = path.join(videoDir, "checkpoints.json");
let checkpoints = null;
if (fs.existsSync(checkpointsPath)) {
  checkpoints = JSON.parse(fs.readFileSync(checkpointsPath, "utf8"));
}

const capturePath = path.join(videoDir, "capture.webm");
if (!fs.existsSync(capturePath)) {
  console.error(`Video capture not found: ${capturePath}`);
  console.error("Run the Playwright test first with video enabled.");
  process.exit(1);
}

// --- Compute clip start/end times ---
// Map: P1->N1, P2->N2, P3->N3, P4->N4, P5->N5, P6->N6, P7a->N7, P7b->N7 (shared), P8->N8, P9->N9
// P7a and P7b share N7's narration. We split N7's duration between them.
const clipPlan = [];
let totalDuration = 0;

if (checkpoints) {
  // Use real checkpoint timestamps from the recording
  const cpTimes = CHECKPOINTS.map((cp) => ({
    name: cp,
    startMs: checkpoints[cp] ?? 0,
  }));
  for (let i = 0; i < cpTimes.length; i++) {
    const cp = cpTimes[i];
    const next = cpTimes[i + 1];
    const endMs = next ? next.startMs : null;
    clipPlan.push({ name: cp.name, startMs: cp.startMs, endMs });
  }
} else {
  // Fallback: equal slicing based on audio durations
  // Each clip gets its narration duration + 1s pad for visual breathing
  let cursorMs = 0;
  const narrationMap = {
    P1: "N1", P2: "N2", P3: "N3", P4: "N4", P5: "N5",
    P6: "N6", P7a: "N7", P7b: null, P8: "N8", P9: "N9",
  };

  for (const cp of CHECKPOINTS) {
    const narrId = narrationMap[cp];
    let clipDur = 5; // default 5s if no audio
    if (narrId && durations[narrId] != null) {
      clipDur = durations[narrId] + 1; // +1s pad
    }
    // P7b shares N7's time — give it half of N7's remaining duration
    if (cp === "P7b") {
      const n7Dur = durations["N7"] ?? 20;
      clipDur = n7Dur * 0.4; // 40% of N7 for the revoke note
    }
    if (cp === "P7a") {
      const n7Dur = durations["N7"] ?? 20;
      clipDur = n7Dur * 0.6; // 60% of N7 for isolation
    }
    clipPlan.push({
      name: cp,
      startMs: cursorMs,
      endMs: cursorMs + clipDur * 1000,
    });
    cursorMs += clipDur * 1000;
  }
}

// --- Extract and combine each clip ---
const segFiles = [];
const CROSSFADE = 0.3; // seconds

for (let i = 0; i < clipPlan.length; i++) {
  const clip = clipPlan[i];
  const startSec = clip.startMs / 1000;
  const endSec = clip.endMs ? clip.endMs / 1000 : startSec + 5;
  const clipDur = endSec - startSec;

  // Map checkpoint to narration segment
  const narrMap = {
    P1: "N1", P2: "N2", P3: "N3", P4: "N4", P5: "N5",
    P6: "N6", P7a: "N7", P7b: null, P8: "N8", P9: "N9",
  };
  const narrId = narrMap[clip.name];
  const audioFile = narrId ? path.join(audioDir, `${narrId}.mp3`) : null;
  const hasAudio = audioFile && fs.existsSync(audioFile);

  const segFile = path.join(outputDir, `seg_${clip.name}.mp4`);

  if (hasAudio) {
    // Lay narration under video, pad/trim video to audio length, normalize audio
    const audioDur = durations[narrId] ?? clipDur;
    const videoDur = Math.max(clipDur, audioDur);

    // P7a gets 60% of N7, P7b gets 40% — trim audio accordingly
    let audioFilter = "";
    let audioDuration = audioDur;
    if (clip.name === "P7a") {
      audioFilter = `-t ${audioDur * 0.6}`;
      audioDuration = audioDur * 0.6;
    } else if (clip.name === "P7b") {
      // P7b has no narration — silent clip
      audioFilter = `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${audioDur * 0.4}`;
      audioDuration = audioDur * 0.4;
    }

    if (clip.name === "P7b") {
      // Silent clip for P7b
      execSync(
        `ffmpeg -y -ss ${startSec} -t ${audioDuration} -i "${capturePath}" ` +
        `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 ` +
        `-map 0:v -map 1:a -shortest ` +
        `-vf "scale=1920:1080,fps=30" -c:v libx264 -preset medium -crf 18 ` +
        `-af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k ` +
        `"${segFile}"`,
        { stdio: "inherit", timeout: 60_000 },
      );
    } else {
      const trimDur = clip.name === "P7a" ? audioDuration : videoDur;
      execSync(
        `ffmpeg -y -ss ${startSec} -t ${trimDur} -i "${capturePath}" ` +
        `-i "${audioFile}" ` +
        `-map 0:v -map 1:a -shortest ` +
        `-vf "scale=1920:1080,fps=30" -c:v libx264 -preset medium -crf 18 ` +
        `-af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k ` +
        `"${segFile}"`,
        { stdio: "inherit", timeout: 60_000 },
      );
    }
    totalDuration += audioDuration;
  } else {
    // No audio — video-only clip with silence
    execSync(
      `ffmpeg -y -ss ${startSec} -t ${clipDur} -i "${capturePath}" ` +
      `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 ` +
      `-map 0:v -map 1:a -shortest ` +
      `-vf "scale=1920:1080,fps=30" -c:v libx264 -preset medium -crf 18 ` +
      `-af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k ` +
      `"${segFile}"`,
      { stdio: "inherit", timeout: 60_000 },
    );
    totalDuration += clipDur;
  }

  segFiles.push(segFile);
  console.log(`[assemble] ${clip.name}: ${startSec.toFixed(1)}s–${endSec.toFixed(1)}s -> ${path.basename(segFile)}`);
}

// --- Concat with crossfades ---
// Use the concat filter with xfade for 0.3s crossfades between segments.
// Build a filter complex that chains xfade transitions.
const finalOutput = path.join(outputDir, "never-ask-twice-demo.mp4");

// For simplicity and reliability, use concat demuxer with re-encoding for
// crossfade support. The xfade filter requires all inputs to be same format.
const listFile = path.join(outputDir, "concat_list.txt");
const listContent = segFiles.map((f) => `file '${f}'`).join("\n");
fs.writeFileSync(listFile, listContent);

// First pass: concat with 0.3s crossfade using xfade filter chain
// Build filter complex for N segments with xfade transitions
if (segFiles.length > 1) {
  const inputs = segFiles.map((f) => `-i "${f}"`).join(" ");
  // Build xfade chain: [0:v][1:v]xfade=transition=fade:duration=0.3:offset=D0[v01];
  //   [v01][2:v]xfade=transition=fade:duration=0.3:offset=D0+D1-0.3[v012]; ...
  // Same for audio acrossfade.
  const filterParts = [];
  let prevVideoLabel = "0:v";
  let prevAudioLabel = "0:a";
  let cumulativeDur = 0;

  // Get each segment duration
  const segDurs = segFiles.map((f) => {
    try {
      const out = execSync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${f}"`,
        { encoding: "utf8", timeout: 10_000 },
      ).trim();
      return parseFloat(out);
    } catch {
      return 5;
    }
  });

  for (let i = 1; i < segFiles.length; i++) {
    cumulativeDur += segDurs[i - 1] - CROSSFADE;
    const vOut = i < segFiles.length - 1 ? `v${i}` : "vout";
    const aOut = i < segFiles.length - 1 ? `a${i}` : "aout";
    filterParts.push(
      `[${prevVideoLabel}][${i}:v]xfade=transition=fade:duration=${CROSSFADE}:offset=${cumulativeDur}[${vOut}]`,
    );
    filterParts.push(
      `[${prevAudioLabel}][${i}:a]acrossfade=d=${CROSSFADE}:c1=tri:c2=tri[${aOut}]`,
    );
    prevVideoLabel = vOut;
    prevAudioLabel = aOut;
  }

  const filterComplex = filterParts.join(";");

  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" ` +
    `-map "[vout]" -map "[aout]" ` +
    `-c:v libx264 -preset medium -crf 18 -r 30 ` +
    // No -vf here: the streams come out of -filter_complex (xfade/acrossfade)
    // and ffmpeg rejects simple + complex filtering on the same stream. The
    // per-segment pass above already normalises every clip to 1920x1080@30.
    ``+
    `-c:a aac -b:a 192k ` +
    `"${finalOutput}"`,
    { stdio: "inherit", timeout: 120_000 },
  );
} else {
  // Single segment — just copy
  execSync(`ffmpeg -y -i "${segFiles[0]}" -c copy "${finalOutput}"`, {
    stdio: "inherit",
    timeout: 60_000,
  });
}

// --- Report final duration ---
let finalDur = 0;
try {
  const out = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${finalOutput}"`,
    { encoding: "utf8", timeout: 10_000 },
  ).trim();
  finalDur = parseFloat(out);
} catch {}

console.log(`\n[assemble] Final video: ${finalOutput}`);
console.log(`[assemble] Duration: ${finalDur.toFixed(1)}s (${Math.floor(finalDur / 60)}:${String(Math.round(finalDur % 60)).padStart(2, "0")})`);

if (finalDur > 180) {
  console.error(
    `[assemble] WARNING: Final video ${finalDur.toFixed(1)}s exceeds 3:00 ceiling. ` +
    `Trim narration or reduce hold times.`,
  );
} else {
  console.log(`[assemble] OK — under 3:00 ceiling.`);
}

// Clean up intermediate files
fs.unlinkSync(listFile);
for (const f of segFiles) {
  try { fs.unlinkSync(f); } catch {}
}
