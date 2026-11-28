import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCheckArg, parseFeedbackArg, tallyChecks } from "./cli.mjs";
import {
  extractEvidenceManifest,
  formatEvidenceMarkdown,
} from "./markdown.mjs";
import {
  findCommittedMediaFiles,
  parseCliArgs,
  validateEvidenceManifest,
  validatePrBody,
  validateVideoUrl,
} from "./validate-pr.mjs";

const HEAD_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OLD_SHA = "1111111111111111111111111111111111111111";
const FIXED_NOW = Date.parse("2026-11-28T10:00:00.000Z");

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "video",
    repository: "PlaybookMediaLLC/kaneo",
    branch: "feat/pr-video-evidence",
    commitSha: HEAD_SHA,
    pullRequest: 42,
    capturedAt: "2026-11-28T09:30:00.000Z",
    app: "kaneo",
    route: "/dashboard/workspace/quills_portal_demo",
    environment: "Isolated pnpm dev:demo stack",
    acceptanceCriteria: [
      {
        id: "AC-1",
        description: "Kanban task creation persists across reload",
        verified: true,
      },
    ],
    assertions: {
      passed: 4,
      failed: 0,
      skipped: 0,
      checks: [{ command: "pnpm lint", status: "passed" }],
    },
    video: {
      url: "https://github.com/PlaybookMediaLLC/kaneo/releases/download/pr-video-evidence/pr-42.mp4",
      durationSeconds: 58.4,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      audioCodec: "aac",
      ttsProvider: "kokoro",
      ttsVoice: "am_michael",
    },
    review: {
      reviewers: ["ponytail-review", "senior-code-critic", "review-changes"],
      soleAuthorReview: false,
      blockingOpen: 0,
      summary: "All blocking findings resolved and re-reviewed.",
    },
    ...overrides,
  };
}

test("round-trips evidence markdown with the real PR template and strips local paths", async () => {
  const template = await readFile(
    new URL("../../.github/PULL_REQUEST_TEMPLATE.md", import.meta.url),
    "utf8",
  );
  const manifest = baseManifest({
    video: {
      ...baseManifest().video,
      path: "/home/dev/secret-path/evidence.mp4",
    },
    artifacts: { playwrightTrace: "/home/dev/secret-path/trace.zip" },
  });
  const body = `${template}\n${formatEvidenceMarkdown(manifest)}`;
  assert.doesNotMatch(body, /\/home\/dev\/secret-path/);

  const extracted = extractEvidenceManifest(body);
  assert.equal(extracted.ok, true);
  assert.equal(extracted.manifest.video.path, undefined);
  assert.equal(extracted.manifest.artifacts, undefined);

  const result = validatePrBody(body, {
    repository: "PlaybookMediaLLC/kaneo",
    branch: "feat/pr-video-evidence",
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
    changedFiles: [{ filename: "AGENTS.md", status: "modified" }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects duplicate evidence blocks and visible-markdown spoofing", () => {
  const md = formatEvidenceMarkdown(baseManifest());
  const duplicate = validatePrBody(`${md}\n\n${md}`, {
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
  });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join("\n"), /Found 2/);

  const spoofed = `<!-- pr-video-evidence:start -->\nFake text without real SHA or link\n<!-- pr-video-evidence:json\n${JSON.stringify(baseManifest())}\npr-video-evidence:json -->\n<!-- pr-video-evidence:end -->`;
  const spoofResult = validatePrBody(spoofed, {
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
  });
  assert.equal(spoofResult.valid, false);
  assert.match(
    spoofResult.errors.join("\n"),
    /Visible PR evidence markdown must display/,
  );
});

test("rejects stale commit SHA and missing pullRequest number once PR is assigned", () => {
  const stale = validateEvidenceManifest(baseManifest({ commitSha: OLD_SHA }), {
    repository: "PlaybookMediaLLC/kaneo",
    branch: "feat/pr-video-evidence",
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
  });
  assert.equal(stale.valid, false);
  assert.match(stale.errors.join("\n"), /Stale evidence/i);

  const missingPr = validateEvidenceManifest(
    baseManifest({ pullRequest: null }),
    {
      headSha: HEAD_SHA,
      pullRequest: 42,
      nowMs: FIXED_NOW,
    },
  );
  assert.equal(missingPr.valid, false);
  assert.match(missingPr.errors.join("\n"), /Pull request mismatch/);
});

test("rejects JS coercion bypasses, invalid mode, bad capturedAt, and unsafe URLs", () => {
  const coerced = validateEvidenceManifest(
    baseManifest({
      mode: "bogus",
      capturedAt: "1",
      assertions: { passed: true, failed: null, skipped: 0 },
      review: {
        reviewers: ["  "],
        blockingOpen: "",
        summary: "  ",
      },
    }),
    { headSha: HEAD_SHA, pullRequest: 42, nowMs: FIXED_NOW },
  );
  assert.equal(coerced.valid, false);
  const text = coerced.errors.join("\n");
  assert.match(text, /Invalid mode/);
  assert.match(text, /capturedAt/);
  assert.match(text, /integer passed count/);
  assert.match(text, /failed === 0/);
  assert.match(text, /non-empty independent reviewer/);
  assert.match(text, /soleAuthorReview: false/);
  assert.match(text, /blockingOpen === 0/);
  assert.match(text, /non-empty summary/);

  assert.ok(validateVideoUrl("https://user:pass@example.com/v.mp4"));
  assert.ok(validateVideoUrl("https://localhost/v.mp4"));
  assert.ok(validateVideoUrl("https://127.0.0.1/v.mp4"));
  assert.ok(
    validateVideoUrl("https://example.com/v.mp4)![](https://evil.test/x"),
  );
  assert.equal(
    validateVideoUrl(
      "https://github.com/PlaybookMediaLLC/kaneo/releases/download/v1/demo.mp4",
    ),
    null,
  );
});

test("rejects committed binary recording artifacts and trace.zip in PR diff", () => {
  const bad = findCommittedMediaFiles([
    { filename: "AGENTS.md", status: "modified" },
    { filename: "apps/api/src/index.ts", status: "modified" },
    { filename: "docs/demo.mp4", status: "added" },
    { filename: "old.webm", status: "removed" },
    { filename: "narration.wav", status: "added" },
    { filename: "trace.zip", status: "added" },
    { filename: ".cache/pr-video-evidence/run/evidence.json", status: "added" },
  ]);
  assert.deepEqual(bad, [
    "docs/demo.mp4",
    "narration.wav",
    "trace.zip",
    ".cache/pr-video-evidence/run/evidence.json",
  ]);
});

test("accepts justified non-demonstrable mode and rejects empty skips or bad CLI flags", () => {
  const validNonDemo = baseManifest({
    mode: "non-demonstrable",
    video: undefined,
    nonDemonstrableReason:
      "Documentation-only policy typo fix with zero runtime, API, or UI behavior changes.",
    equivalentArtifacts: ["pnpm lint — passed", "git diff verified"],
  });
  const ok = validateEvidenceManifest(validNonDemo, {
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
  });
  assert.equal(ok.valid, true);

  const silentSkip = baseManifest({
    mode: "non-demonstrable",
    video: undefined,
    nonDemonstrableReason: "n/a",
    equivalentArtifacts: [null, "   "],
  });
  const bad = validateEvidenceManifest(silentSkip, {
    headSha: HEAD_SHA,
    pullRequest: 42,
    nowMs: FIXED_NOW,
  });
  assert.equal(bad.valid, false);
  assert.match(bad.errors.join("\n"), /at least 20 characters/);
  assert.match(
    bad.errors.join("\n"),
    /non-empty equivalent verification artifact/,
  );

  assert.throws(() => parseCliArgs(["--unknown-flag"]), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--pr", "abc"]), /Invalid --pr/);
});

test("parses colon-containing --check commands and feedback flags accurately", () => {
  assert.deepEqual(parseCheckArg("pnpm openapi:check"), {
    command: "pnpm openapi:check",
    status: "passed",
  });
  assert.deepEqual(parseCheckArg("pnpm i18n:check:failed"), {
    command: "pnpm i18n:check",
    status: "failed",
  });
  assert.deepEqual(
    tallyChecks([
      parseCheckArg("pnpm lint:passed"),
      parseCheckArg("pnpm openapi:check:failed"),
      parseCheckArg("pnpm test:e2e:skipped"),
    ]),
    { passed: 1, failed: 1, skipped: 1 },
  );
  assert.deepEqual(parseFeedbackArg("Fix button contrast:addressed"), {
    comment: "Fix button contrast",
    status: "addressed",
  });
});
