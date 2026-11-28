import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// af_heart is Kokoro's Grade-A voice; fp32 avoids 8-bit quantization grain and runs fast on CPU.
export const DEFAULT_KOKORO_VOICE = "af_heart";
export const DEFAULT_KOKORO_DTYPE = "fp32";
export const DEFAULT_KOKORO_SPEED = 0.98;
export const DEFAULT_OPENAI_VOICE = "marin";
const SENTENCE_PAUSE_MS = 220;
const ABBREVIATIONS = new Set([
  "dr",
  "e.g",
  "etc",
  "i.e",
  "mr",
  "mrs",
  "ms",
  "vs",
]);

const cachedKokoroByDtype = new Map();

export function parseTtsSpeed(raw) {
  if (raw === undefined || raw === null) return DEFAULT_KOKORO_SPEED;
  const text = String(raw).trim();
  if (!text) {
    throw new Error("Invalid TTS speed (expected 0.7..1.3): empty value");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0.7 || parsed > 1.3) {
    throw new Error(`Invalid TTS speed (expected 0.7..1.3): ${raw}`);
  }
  return parsed;
}

/** Normalizes technical tokens into natural spoken phrasing while keeping written text intact for captions. */
export function prepareSpokenText(text) {
  return String(text ?? "")
    .replaceAll("`", "")
    .replace(/\s*->\s*/g, " to ")
    .replace(/\bPostgreSQL\b/g, "Postgres")
    .replace(/\bPRs\b/g, "pull requests")
    .replace(/\bPR\b/g, "pull request")
    .replace(/\bAC-(\d+)\b/g, "acceptance criterion $1")
    .replace(/\bH\.264\b/gi, "H 2 64")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits narration at sentence boundaries followed by whitespace without breaking decimals, URLs, paths, or abbreviations. */
export function splitIntoSentences(text) {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];

  const sentences = [];
  let start = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    let end = i;
    while (end + 1 < clean.length && ".!?\"')]".includes(clean[end + 1])) {
      end += 1;
    }
    if (end + 1 >= clean.length) break;
    if (clean[end + 1] !== " ") continue;
    // Never split inside abbreviations like "e.g.", "i.e.", "Dr.", "vs.".
    if (ch === ".") {
      const before = clean.slice(start, i);
      const token = before.match(/([A-Za-z](?:\.[A-Za-z])*|[A-Za-z]+)$/)?.[1];
      if (token && ABBREVIATIONS.has(token.toLowerCase())) continue;
    }
    const piece = clean.slice(start, end + 1).trim();
    if (piece) sentences.push(piece);
    start = end + 2;
    i = end + 1;
  }
  const tail = clean.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/** Joins float32 PCM audio arrays with natural silence pauses between sentences. */
export function concatFloat32Audio(
  segments,
  sampleRate,
  pauseMs = SENTENCE_PAUSE_MS,
) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Cannot concatenate empty audio segment list.");
  }
  if (segments.length === 1) return segments[0];
  const pauseSamples = Math.max(0, Math.round((sampleRate * pauseMs) / 1000));
  const totalSamples =
    segments.reduce((sum, seg) => sum + seg.length, 0) +
    pauseSamples * (segments.length - 1);
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (let i = 0; i < segments.length; i += 1) {
    merged.set(segments[i], offset);
    offset += segments[i].length;
    if (i < segments.length - 1) offset += pauseSamples;
  }
  return merged;
}

/** Reads PCM/IEEE-float WAV duration from the RIFF header, clamping streaming 0xFFFFFFFF/0 data sizes. */
export function parseWavDurationSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error("Invalid WAV buffer: too short.");
  }
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Invalid WAV buffer: missing RIFF/WAVE header.");
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  let foundData = false;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkSize >= 16 && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      foundData = true;
      const remaining = buffer.length - (offset + 8);
      dataSize =
        chunkSize === 0 || chunkSize === 0xffffffff || chunkSize > remaining
          ? remaining
          : chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !foundData || dataSize <= 0) {
    throw new Error("Invalid WAV buffer: missing fmt byteRate or data chunk.");
  }
  return dataSize / byteRate;
}

async function loadKokoro(dtype) {
  if (cachedKokoroByDtype.has(dtype)) return cachedKokoroByDtype.get(dtype);
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained(DEFAULT_KOKORO_MODEL, {
    dtype,
    device: "cpu",
  });
  cachedKokoroByDtype.set(dtype, tts);
  return tts;
}

async function synthesizeKokoro(text, outputPath, { voice, dtype, speed }) {
  const tts = await loadKokoro(dtype);
  const sentences = splitIntoSentences(prepareSpokenText(text));
  const generated = [];

  for (const sentence of sentences) {
    generated.push(await tts.generate(sentence, { voice, speed }));
  }

  const first = generated[0];
  const sampleRate = first.sampling_rate;
  const mergedSamples = concatFloat32Audio(
    generated.map((item) => item.audio),
    sampleRate,
    SENTENCE_PAUSE_MS,
  );
  const combined = new first.constructor(mergedSamples, sampleRate);
  await combined.save(outputPath);
  const buffer = await readFile(outputPath);
  return {
    path: outputPath,
    durationSeconds: parseWavDurationSeconds(buffer),
    provider: "kokoro",
    voice,
  };
}

async function synthesizeOpenAI(text, outputPath, { voice, speed }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Cloud TTS fallback requested (openai), but OPENAI_API_KEY is not set.",
    );
  }
  const model = process.env.PR_VIDEO_OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const body = {
    model,
    voice,
    input: prepareSpokenText(text),
    speed,
    response_format: "wav",
    ...(model.includes("gpt-4o")
      ? {
          instructions:
            "Speak like a calm, clear senior software engineer walking a teammate through a screen recording. Use natural human pacing, phrasing, and subtle warmth with no sales hype.",
        }
      : {}),
  };
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI TTS returned HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  return {
    path: outputPath,
    durationSeconds: parseWavDurationSeconds(buffer),
    provider: "openai",
    voice,
  };
}

export async function synthesizeSteps(steps, audioDir, options = {}) {
  const initialProvider = (
    options.provider ||
    process.env.PR_VIDEO_TTS_PROVIDER ||
    "kokoro"
  ).toLowerCase();
  const dtype =
    options.dtype || process.env.PR_VIDEO_TTS_DTYPE || DEFAULT_KOKORO_DTYPE;
  const speed = parseTtsSpeed(options.speed ?? process.env.PR_VIDEO_TTS_SPEED);

  let activeProvider = initialProvider;
  let activeVoice =
    options.voice ||
    process.env.PR_VIDEO_TTS_VOICE ||
    (activeProvider === "openai" ? DEFAULT_OPENAI_VOICE : DEFAULT_KOKORO_VOICE);

  await mkdir(audioDir, { recursive: true });
  const clips = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const text = String(step.narration ?? "").trim();
    if (!text) {
      throw new Error(
        `Step "${step.id}" has empty narration; every verification step must be narrated.`,
      );
    }
    const outputPath = join(
      audioDir,
      `step-${String(i + 1).padStart(2, "0")}.wav`,
    );
    let clip;
    if (activeProvider === "kokoro") {
      try {
        clip = await synthesizeKokoro(text, outputPath, {
          voice: activeVoice,
          dtype,
          speed,
        });
      } catch (error) {
        if (options.fallback === "openai" && process.env.OPENAI_API_KEY) {
          console.warn(
            `Kokoro TTS failed (${error.message}); switching to approved cloud TTS fallback (openai).`,
          );
          activeProvider = "openai";
          activeVoice = DEFAULT_OPENAI_VOICE;
          clip = await synthesizeOpenAI(text, outputPath, {
            voice: activeVoice,
            speed,
          });
        } else {
          throw new Error(`Local Kokoro TTS failed: ${error.message}`);
        }
      }
    } else if (activeProvider === "openai") {
      clip = await synthesizeOpenAI(text, outputPath, {
        voice: activeVoice,
        speed,
      });
    } else {
      throw new Error(
        `Unsupported TTS provider "${activeProvider}". Supported: kokoro, openai.`,
      );
    }
    clips.push({
      stepId: step.id,
      narration: text,
      ...clip,
    });
  }

  return clips;
}
