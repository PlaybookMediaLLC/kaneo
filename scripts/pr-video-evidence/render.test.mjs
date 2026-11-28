import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaptionCues,
  buildSrt,
  buildTranscript,
  buildVtt,
  formatSrtTimestamp,
  formatVttTimestamp,
} from "./render.mjs";
import { redactTerminalOutput } from "./scenarios/terminal.mjs";
import { parseWavDurationSeconds } from "./tts.mjs";

function makeMinimalWav(
  durationSeconds,
  {
    sampleRate = 24_000,
    channels = 1,
    bitsPerSample = 16,
    declaredDataSize = null,
  } = {},
) {
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const dataSize = Math.round(durationSeconds * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(declaredDataSize ?? dataSize, 40);
  return buffer;
}

test("formats SRT and WebVTT timestamps accurately", () => {
  assert.equal(formatSrtTimestamp(0), "00:00:00,000");
  assert.equal(formatSrtTimestamp(65_432), "00:01:05,432");
  assert.equal(formatVttTimestamp(65_432), "00:01:05.432");
});

test("splits narration into synchronized SRT/VTT caption cues and sanitizes ASS tags", () => {
  const timeline = [
    {
      stepId: "signin",
      startMs: 1000,
      durationSeconds: 6,
      narration:
        "Signing into {\\b1}isolated-->Kaneo workspace confirms live authentication against the real PostgreSQL API without mocked responses.",
    },
  ];
  const cues = buildCaptionCues(timeline);
  assert.ok(cues.length >= 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[cues.length - 1].endMs, 7000);

  const srt = buildSrt(cues);
  assert.match(srt, /^1\n00:00:01,000 --> /);
  assert.doesNotMatch(srt, /\{\\b1\}/);
  const vtt = buildVtt(cues);
  assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> /);
  const transcript = buildTranscript(timeline);
  assert.match(transcript, /\[00:00:01\.000 - 00:00:07\.000\] \(signin\)/);
});

test("parses standard and streaming (0xFFFFFFFF / 0) PCM WAV durations cleanly", () => {
  assert.equal(parseWavDurationSeconds(makeMinimalWav(3.5)), 3.5);
  assert.equal(
    parseWavDurationSeconds(
      makeMinimalWav(2.0, { declaredDataSize: 0xffffffff }),
    ),
    2.0,
  );
  assert.equal(
    parseWavDurationSeconds(makeMinimalWav(1.5, { declaredDataSize: 0 })),
    1.5,
  );
  assert.throws(
    () => parseWavDurationSeconds(Buffer.from("not-a-wav")),
    /Invalid WAV/,
  );
});

test("redacts tokens and strips ANSI escapes from terminal output", () => {
  const raw =
    "\u001b[32mPASS\u001b[0m Bearer eyJhbGciOiJIUzI1NiJ9.abc.def sk-proj-1234567890abcdef1234 ghp_abcdef1234567890";
  const clean = redactTerminalOutput(raw);
  assert.equal(
    clean,
    "PASS Bearer [REDACTED] [REDACTED_API_KEY] [REDACTED_GH_TOKEN]",
  );
});
