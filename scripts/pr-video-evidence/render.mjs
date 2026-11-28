import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function formatSrtTimestamp(ms) {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function formatVttTimestamp(ms) {
  return formatSrtTimestamp(ms).replace(",", ".");
}

function sanitizeCaptionText(text) {
  return String(text ?? "")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replaceAll("-->", "->")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits long narration cues into readable 2-line caption chunks aligned proportionally across the clip duration. */
export function buildCaptionCues(timeline) {
  const cues = [];
  for (const item of timeline) {
    const clean = sanitizeCaptionText(item.narration);
    const words = clean.split(" ").filter(Boolean);
    if (words.length === 0) continue;
    const chunks = [];
    let current = [];
    let currentLen = 0;
    for (const word of words) {
      if (current.length > 0 && currentLen + 1 + word.length > 76) {
        chunks.push(current.join(" "));
        current = [word];
        currentLen = word.length;
      } else {
        current.push(word);
        currentLen += (current.length > 1 ? 1 : 0) + word.length;
      }
    }
    if (current.length > 0) chunks.push(current.join(" "));

    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
    let cursorMs = item.startMs;
    const durationMs = Math.max(500, Math.round(item.durationSeconds * 1000));
    for (let i = 0; i < chunks.length; i += 1) {
      const share =
        i === chunks.length - 1
          ? item.startMs + durationMs - cursorMs
          : Math.max(
              400,
              Math.round((chunks[i].length / totalChars) * durationMs),
            );
      const endMs = Math.min(item.startMs + durationMs, cursorMs + share);
      cues.push({
        stepId: item.stepId,
        startMs: cursorMs,
        endMs: Math.max(cursorMs + 250, endMs),
        text: chunks[i],
      });
      cursorMs = endMs;
    }
  }
  return cues;
}

export function buildSrt(cues) {
  return cues
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}\n${sanitizeCaptionText(cue.text)}\n`,
    )
    .join("\n");
}

export function buildVtt(cues) {
  const body = cues
    .map(
      (cue) =>
        `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}\n${sanitizeCaptionText(cue.text)}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function buildTranscript(timeline) {
  return timeline
    .map(
      (item) =>
        `[${formatVttTimestamp(item.startMs)} - ${formatVttTimestamp(item.startMs + item.durationSeconds * 1000)}] (${item.stepId}) ${item.narration}`,
    )
    .join("\n");
}

function runFfmpeg(args, label, cwd) {
  const result = spawnSync("ffmpeg", ["-loglevel", "warning", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
  });
  if (result.error) {
    throw new Error(
      `Failed to start ffmpeg (${label}): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed (${label}): ${result.stderr.trim().slice(-1500)}`,
    );
  }
}

export function probeMedia(filePath) {
  const resolved = resolve(filePath);
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", resolved],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `ffprobe failed for ${resolved}: ${result.stderr || result.error?.message}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  const rateParts = String(video?.r_frame_rate ?? "0/1").split("/");
  const fps =
    rateParts.length === 2 && Number(rateParts[1]) > 0
      ? Math.round(Number(rateParts[0]) / Number(rateParts[1]))
      : 0;
  return {
    durationSeconds: Number(Number(parsed.format?.duration ?? 0).toFixed(2)),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    fps,
    videoCodec: video?.codec_name ?? "",
    audioCodec: audio?.codec_name ?? "",
  };
}

export async function sha256File(filePath) {
  return new Promise((done, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => done(hash.digest("hex")));
  });
}

export async function renderEvidenceVideo({
  rawVideoPath,
  timeline,
  outputDir,
  width = 1920,
  height = 1080,
  fps = 30,
}) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new Error("Cannot render video without narrated timeline entries.");
  }
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(fps) ||
    fps <= 0
  ) {
    throw new Error(
      `Invalid render geometry: width=${width}, height=${height}, fps=${fps}`,
    );
  }

  const resolvedOutputDir = resolve(outputDir);
  const resolvedRawVideo = resolve(rawVideoPath);
  await mkdir(resolvedOutputDir, { recursive: true });

  const cues = buildCaptionCues(timeline);
  const srtPath = join(resolvedOutputDir, "captions.srt");
  const vttPath = join(resolvedOutputDir, "captions.vtt");
  const transcriptPath = join(resolvedOutputDir, "transcript.txt");
  const mixedAudioPath = join(resolvedOutputDir, "narration-mixed.wav");
  const finalMp4Path = join(resolvedOutputDir, "evidence.mp4");

  await writeFile(srtPath, buildSrt(cues), "utf8");
  await writeFile(vttPath, buildVtt(cues), "utf8");
  await writeFile(transcriptPath, `${buildTranscript(timeline)}\n`, "utf8");

  // Place each WAV narration clip at its exact recorded millisecond offset without loudness attenuation.
  const audioInputs = [];
  const filterParts = [];
  const mixLabels = [];
  for (let i = 0; i < timeline.length; i += 1) {
    const entry = timeline[i];
    const delayMs = Math.max(0, Math.round(entry.startMs));
    audioInputs.push("-i", resolve(entry.audioPath));
    filterParts.push(
      `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs}[a${i}]`,
    );
    mixLabels.push(`[a${i}]`);
  }
  const mixChain =
    timeline.length === 1
      ? `${filterParts[0]};[a0]highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11[outa]`
      : `${filterParts.join(";")};${mixLabels.join("")}amix=inputs=${timeline.length}:duration=longest:dropout_transition=0:normalize=0,highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11[outa]`;

  runFfmpeg(
    [
      "-y",
      ...audioInputs,
      "-filter_complex",
      mixChain,
      "-map",
      "[outa]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      mixedAudioPath,
    ],
    "mix-narration",
    resolvedOutputDir,
  );

  // Run with cwd=resolvedOutputDir and static filename=captions.srt so zero dynamic path characters enter -vf.
  // ASS alpha is inverted (00=opaque, FF=transparent): &H330F172A is 80% opaque dark slate for light/dark readability.
  const subStyle =
    "FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H330F172A,BorderStyle=4,Outline=1,Shadow=0,MarginV=20,Alignment=2";
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a`,
    `fps=${fps}`,
    `subtitles=filename=captions.srt:force_style='${subStyle}'`,
  ].join(",");

  runFfmpeg(
    [
      "-y",
      "-i",
      resolvedRawVideo,
      "-i",
      mixedAudioPath,
      "-vf",
      vf,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      finalMp4Path,
    ],
    "render-mp4",
    resolvedOutputDir,
  );

  const probed = probeMedia(finalMp4Path);
  if (
    probed.videoCodec !== "h264" ||
    probed.audioCodec !== "aac" ||
    probed.width !== width ||
    probed.height !== height ||
    probed.fps !== fps
  ) {
    throw new Error(
      `Rendered MP4 failed format verification: expected ${width}x${height} @ ${fps}fps h264/aac, got ${JSON.stringify(probed)}`,
    );
  }

  const sha256 = await sha256File(finalMp4Path);
  return {
    mp4Path: finalMp4Path,
    srtPath,
    vttPath,
    transcriptPath,
    mixedAudioPath,
    video: {
      ...probed,
      sha256,
    },
  };
}
