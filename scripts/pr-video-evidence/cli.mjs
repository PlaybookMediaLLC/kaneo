#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatEvidenceMarkdown } from "./markdown.mjs";
import { recordScenario } from "./recorder.mjs";
import { parseTtsSpeed } from "./tts.mjs";
import { validateEvidenceManifest } from "./validate-pr.mjs";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function resolveRepository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = git(["config", "--get", "remote.origin.url"]);
  const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
  return match ? match[1] : "PlaybookMediaLLC/kaneo";
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

/** Parses --check "pnpm openapi:check:passed" without splitting colons inside script names. */
export function parseCheckArg(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(/^(.*?):(passed|failed|skipped)$/i);
  if (match) {
    return {
      command: match[1].trim(),
      status: match[2].toLowerCase(),
    };
  }
  return { command: text, status: "passed" };
}

export function parseFeedbackArg(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(/^(.*?):(addressed|outstanding)$/i);
  if (match) {
    return {
      comment: match[1].trim(),
      status: match[2].toLowerCase(),
    };
  }
  return { comment: text, status: "addressed" };
}

export function tallyChecks(checks) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const check of checks) {
    if (check.status === "passed") passed += 1;
    else if (check.status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { passed, failed, skipped };
}

export function parseArgs(argv) {
  const options = {
    app: "kaneo",
    baseUrl: process.env.PR_VIDEO_BASE_URL || "http://127.0.0.1:5190",
    ttsProvider: process.env.PR_VIDEO_TTS_PROVIDER || "kokoro",
    ttsVoice: process.env.PR_VIDEO_TTS_VOICE,
    ttsFallback: process.env.PR_VIDEO_TTS_FALLBACK,
    width: 1920,
    height: 1080,
    fps: 30,
    checks: [],
    reviewers: [],
    equivalentArtifacts: [],
    addressedFeedback: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app") {
      options.app = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--script") {
      options.script = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--out") {
      options.out = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--tts") {
      options.ttsProvider = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--voice") {
      options.ttsVoice = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--speed") {
      options.ttsSpeed = parseTtsSpeed(requireValue(argv, i, arg));
      i += 1;
    } else if (arg === "--fallback") {
      options.ttsFallback = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--pr") {
      const raw = requireValue(argv, i, arg);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --pr number: ${raw}`);
      }
      options.pullRequest = parsed;
      i += 1;
    } else if (arg === "--video-url") {
      options.videoUrl = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--review-summary") {
      options.reviewSummary = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--reviewer") {
      options.reviewers.push(requireValue(argv, i, arg));
      i += 1;
    } else if (arg === "--check") {
      options.checks.push(requireValue(argv, i, arg));
      i += 1;
    } else if (arg === "--addressed-feedback") {
      options.addressedFeedback.push(requireValue(argv, i, arg));
      i += 1;
    } else if (arg === "--non-demonstrable") {
      options.nonDemonstrableReason = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--artifact") {
      options.equivalentArtifacts.push(requireValue(argv, i, arg));
      i += 1;
    } else if (arg === "--route") {
      options.route = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--environment") {
      options.environment = requireValue(argv, i, arg);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm devx:video-evidence [options]

Options:
  --app <kaneo|quills|terminal>     Built-in scenario surface (default: kaneo)
  --script <path>                   Custom Playwright scenario .mjs module
  --base-url <url>                  Running application URL (default: http://127.0.0.1:5190)
  --out <dir>                       Output directory (default: .cache/pr-video-evidence/<timestamp>)
  --tts <kokoro|openai>             TTS provider (default: kokoro)
  --voice <id>                      Voice name (default: af_heart for kokoro)
  --speed <0.7-1.3>                 Speech rate (default: 0.98)
  --fallback <openai>               Optional cloud TTS fallback when local Kokoro fails
  --pr <number>                     Pull request number once assigned
  --video-url <https://...>         Accessible hosted video URL for PR description
  --reviewer <name>                 Independent reviewer pass (required, repeatable)
  --review-summary <text>           Consolidated independent review summary (required)
  --check <cmd[:passed|failed]>     Automated check result (repeatable)
  --addressed-feedback <msg[:status]> Feedback loop entry (addressed|outstanding, repeatable)
  --non-demonstrable <reason>       Generate a justified non-demonstrable evidence block
  --artifact <text>                 Equivalent verification artifact for non-demonstrable mode
`);
}

async function loadScenario(options) {
  if (options.script) {
    const mod = await import(pathToFileURL(resolve(options.script)).href);
    return mod.default ?? mod.scenario;
  }
  if (options.app === "kaneo") {
    const mod = await import("./scenarios/kaneo-board.mjs");
    return mod.default;
  }
  if (options.app === "quills") {
    const mod = await import("./scenarios/quills-portal.mjs");
    return mod.default;
  }
  throw new Error(
    `Built-in app "${options.app}" requires --script <scenario.mjs> (built-ins: kaneo, quills).`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    console.warn(
      "[video-evidence] Warning: git worktree has uncommitted changes. Commit before generating final PR evidence so commitSha matches exact runtime code.",
    );
  }

  const timestamp = new Date().toISOString();
  const runId = timestamp.replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
  const outputDir = resolve(
    options.out || join(".cache/pr-video-evidence", runId),
  );
  await mkdir(outputDir, { recursive: true });

  const repository = resolveRepository();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";
  const commitSha = git(["rev-parse", "HEAD"]);
  const extraChecks = options.checks.map(parseCheckArg);
  const checkCounts = tallyChecks(extraChecks);
  const addressedFeedback = options.addressedFeedback.map(parseFeedbackArg);

  // Never fabricate independent review results: fail fast if required review inputs are missing.
  if (
    options.reviewers.length === 0 ||
    !String(options.reviewSummary ?? "").trim()
  ) {
    throw new Error(
      "Missing independent review attestation. Provide at least one --reviewer <name> and --review-summary <text> after completing independent review.",
    );
  }
  const review = {
    reviewers: options.reviewers,
    soleAuthorReview: false,
    blockingOpen: 0,
    summary: options.reviewSummary.trim(),
  };

  let manifest;

  if (options.nonDemonstrableReason) {
    manifest = {
      schemaVersion: 1,
      mode: "non-demonstrable",
      repository,
      branch,
      commitSha,
      pullRequest: options.pullRequest ?? null,
      capturedAt: timestamp,
      app: options.app || "non-demonstrable",
      route: options.route || "n/a",
      environment:
        options.environment || "Local isolated verification environment",
      nonDemonstrableReason: options.nonDemonstrableReason,
      equivalentArtifacts: options.equivalentArtifacts,
      acceptanceCriteria: [
        {
          id: "AC-1",
          description:
            "Non-demonstrable scope verified via equivalent automated checks.",
          verified: checkCounts.passed > 0 && checkCounts.failed === 0,
        },
      ],
      assertions: {
        passed: checkCounts.passed,
        failed: checkCounts.failed,
        skipped: checkCounts.skipped,
        checks: extraChecks,
      },
      review,
      ...(addressedFeedback.length > 0 ? { addressedFeedback } : {}),
    };
  } else {
    const scenario = await loadScenario(options);
    const recording = await recordScenario({
      scenario,
      baseUrl: options.baseUrl,
      outputDir,
      ttsProvider: options.ttsProvider,
      ttsVoice: options.ttsVoice,
      ttsSpeed: options.ttsSpeed,
      ttsFallback: options.ttsFallback,
      width: options.width,
      height: options.height,
      fps: options.fps,
    });

    const livePassed =
      recording.assertions.passed > 0 && recording.assertions.failed === 0;
    manifest = {
      schemaVersion: 1,
      mode: "video",
      repository,
      branch,
      commitSha,
      pullRequest: options.pullRequest ?? null,
      capturedAt: timestamp,
      app: scenario.app || options.app,
      route: options.route || scenario.route,
      environment: options.environment || scenario.environment,
      acceptanceCriteria: (scenario.acceptanceCriteria || []).map((item) => ({
        ...item,
        verified: livePassed,
      })),
      assertions: {
        passed: recording.assertions.passed + checkCounts.passed,
        failed: recording.assertions.failed + checkCounts.failed,
        skipped: recording.assertions.skipped + checkCounts.skipped,
        checks: extraChecks,
        live: recording.assertions.live,
      },
      video: {
        ...recording.video,
        ...(options.videoUrl ? { url: options.videoUrl } : {}),
      },
      artifacts: {
        rawVideo: recording.rawVideoPath,
        transcript: recording.transcriptPath,
        captionsSrt: recording.srtPath,
        captionsVtt: recording.vttPath,
        playwrightTrace: recording.tracePath,
      },
      review,
      ...(addressedFeedback.length > 0 ? { addressedFeedback } : {}),
    };
  }

  const manifestPath = join(outputDir, "evidence.json");
  const markdownPath = join(outputDir, "evidence.md");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const markdown = formatEvidenceMarkdown(manifest);
  await writeFile(markdownPath, `${markdown}\n`, "utf8");

  const validation = validateEvidenceManifest(manifest, {
    repository,
    branch,
    headSha: commitSha,
    pullRequest: options.pullRequest,
    requireAccessibleUrl: Boolean(options.videoUrl),
  });

  if (!validation.valid) {
    console.error("[video-evidence] Generated manifest failed validation:");
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exitCode = 1;
    return;
  }

  console.log("[video-evidence] Complete!");
  if (manifest.video?.path) console.log(`  MP4:        ${manifest.video.path}`);
  console.log(`  Manifest:   ${manifestPath}`);
  console.log(`  Markdown:   ${markdownPath}`);
  if (manifest.artifacts?.playwrightTrace) {
    console.log(`  Trace:      ${manifest.artifacts.playwrightTrace}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[video-evidence] Error: ${error instanceof Error ? error.stack || error.message : String(error)}`,
    );
    process.exit(1);
  }
}
