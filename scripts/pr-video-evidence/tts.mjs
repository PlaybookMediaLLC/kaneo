import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_KOKORO_VOICE = "am_michael";
export const DEFAULT_OPENAI_VOICE = "alloy";

let cachedKokoro = null;

/** Reads PCM WAV duration from the RIFF header, clamping streaming 0xFFFFFFFF/0 data sizes. */
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

async function loadKokoro() {
  if (cachedKokoro) return cachedKokoro;
  const { KokoroTTS } = await import("kokoro-js");
  cachedKokoro = await KokoroTTS.from_pretrained(DEFAULT_KOKORO_MODEL, {
    dtype: "q8",
    device: "cpu",
  });
  return cachedKokoro;
}

async function synthesizeKokoro(text, outputPath, voice) {
  const tts = await loadKokoro();
  const audio = await tts.generate(text, { voice });
  await audio.save(outputPath);
  const buffer = await readFile(outputPath);
  return {
    path: outputPath,
    durationSeconds: parseWavDurationSeconds(buffer),
    provider: "kokoro",
    voice,
  };
}

async function synthesizeOpenAI(text, outputPath, voice) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Cloud TTS fallback requested (openai), but OPENAI_API_KEY is not set.",
    );
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PR_VIDEO_OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "wav",
    }),
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
        clip = await synthesizeKokoro(text, outputPath, activeVoice);
      } catch (error) {
        if (options.fallback === "openai" && process.env.OPENAI_API_KEY) {
          console.warn(
            `Kokoro TTS failed (${error.message}); switching to approved cloud TTS fallback (openai).`,
          );
          activeProvider = "openai";
          activeVoice = DEFAULT_OPENAI_VOICE;
          clip = await synthesizeOpenAI(text, outputPath, activeVoice);
        } else {
          throw new Error(`Local Kokoro TTS failed: ${error.message}`);
        }
      }
    } else if (activeProvider === "openai") {
      clip = await synthesizeOpenAI(text, outputPath, activeVoice);
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
