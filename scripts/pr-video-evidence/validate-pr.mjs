import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { extractEvidenceManifest } from "./markdown.mjs";

// TypeScript source files (.ts) are intentionally excluded.
export const FORBIDDEN_BINARY_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
  ".gif",
  ".wav",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
  ".opus",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".3gp",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ALLOWED_MODES = new Set(["video", "non-demonstrable"]);
const ALLOWED_TTS = new Set(["kokoro", "openai"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLocalOrPrivateHost(hostname) {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local")
  ) {
    return true;
  }
  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function validateVideoUrl(rawUrl) {
  if (!isNonEmptyString(rawUrl)) {
    return "Missing accessible https:// video URL in PR evidence metadata.";
  }
  const trimmed = rawUrl.trim();
  if (/[\s()<>]/.test(trimmed)) {
    return "Video URL contains whitespace or disallowed characters (()<>).";
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Video URL is not a valid URL.";
  }
  if (parsed.protocol !== "https:") {
    return `Video URL must use https://, got ${parsed.protocol}`;
  }
  if (parsed.username || parsed.password) {
    return "Video URL must not contain embedded credentials.";
  }
  if (isLocalOrPrivateHost(parsed.hostname)) {
    return `Video URL must be externally accessible, not local/private host "${parsed.hostname}".`;
  }
  return null;
}

export function findCommittedMediaFiles(changedFiles) {
  if (!Array.isArray(changedFiles)) return [];
  const bad = [];
  for (const entry of changedFiles) {
    const filename = typeof entry === "string" ? entry : entry?.filename;
    const status = typeof entry === "string" ? "added" : entry?.status;
    if (!filename || status === "removed") continue;
    const lower = filename.toLowerCase();
    if (
      lower.startsWith(".cache/pr-video-evidence/") ||
      lower === "trace.zip" ||
      lower.endsWith("/trace.zip")
    ) {
      bad.push(filename);
      continue;
    }
    for (const ext of FORBIDDEN_BINARY_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        bad.push(filename);
        break;
      }
    }
  }
  return bad;
}

export function validateEvidenceManifest(manifest, context = {}) {
  const errors = [];
  const warnings = [];
  const committedMedia =
    context._committedMedia ?? findCommittedMediaFiles(context.changedFiles);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      valid: false,
      errors: ["Evidence manifest is missing or not an object."],
      warnings,
    };
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(
      `Unsupported schemaVersion: expected 1, got ${JSON.stringify(manifest.schemaVersion)}.`,
    );
  }

  if (!ALLOWED_MODES.has(manifest.mode)) {
    errors.push(
      `Invalid mode: expected "video" or "non-demonstrable", got ${JSON.stringify(manifest.mode)}.`,
    );
  }

  if (!isNonEmptyString(manifest.repository)) {
    errors.push("Missing repository identifier.");
  } else if (context.repository && manifest.repository !== context.repository) {
    errors.push(
      `Repository mismatch: evidence has "${manifest.repository}", expected "${context.repository}".`,
    );
  }

  if (!isNonEmptyString(manifest.branch)) {
    errors.push("Missing branch name.");
  } else if (context.branch && manifest.branch !== context.branch) {
    errors.push(
      `Branch mismatch: evidence has "${manifest.branch}", expected "${context.branch}".`,
    );
  }

  if (
    typeof manifest.commitSha !== "string" ||
    !SHA_PATTERN.test(manifest.commitSha)
  ) {
    errors.push("Missing or invalid 40-character commitSha.");
  } else if (
    context.headSha &&
    manifest.commitSha.toLowerCase() !== String(context.headSha).toLowerCase()
  ) {
    errors.push(
      `Stale evidence: recorded for commit ${manifest.commitSha}, but PR HEAD is ${context.headSha}. Regenerate video evidence against the latest commit.`,
    );
  }

  if (context.pullRequest != null) {
    if (
      typeof manifest.pullRequest !== "number" ||
      !Number.isInteger(manifest.pullRequest) ||
      manifest.pullRequest !== Number(context.pullRequest)
    ) {
      errors.push(
        `Pull request mismatch: evidence must explicitly reference pullRequest ${context.pullRequest} once assigned (got ${JSON.stringify(manifest.pullRequest)}).`,
      );
    }
  } else if (
    manifest.pullRequest !== null &&
    manifest.pullRequest !== undefined &&
    (typeof manifest.pullRequest !== "number" ||
      !Number.isInteger(manifest.pullRequest) ||
      manifest.pullRequest <= 0)
  ) {
    errors.push("pullRequest must be a positive integer or null.");
  }

  if (
    typeof manifest.capturedAt !== "string" ||
    !ISO_UTC_PATTERN.test(manifest.capturedAt) ||
    Number.isNaN(Date.parse(manifest.capturedAt))
  ) {
    errors.push("Missing or invalid ISO-8601 UTC capturedAt timestamp.");
  } else {
    const capturedMs = Date.parse(manifest.capturedAt);
    const nowMs = context.nowMs ?? Date.now();
    if (capturedMs > nowMs + 10 * 60_000) {
      errors.push("capturedAt timestamp cannot be in the future.");
    }
    if (capturedMs < nowMs - 365 * 24 * 60 * 60_000) {
      errors.push("capturedAt timestamp is older than one year.");
    }
  }

  if (!isNonEmptyString(manifest.route)) {
    errors.push("Missing application route or surface identifier.");
  }

  if (!isNonEmptyString(manifest.environment)) {
    errors.push("Missing isolated test environment description.");
  }

  if (
    !Array.isArray(manifest.acceptanceCriteria) ||
    manifest.acceptanceCriteria.length === 0
  ) {
    errors.push("Acceptance criteria list must be non-empty.");
  } else {
    for (let i = 0; i < manifest.acceptanceCriteria.length; i += 1) {
      const item = manifest.acceptanceCriteria[i];
      if (
        !item ||
        typeof item !== "object" ||
        !isNonEmptyString(item.id) ||
        !isNonEmptyString(item.description)
      ) {
        errors.push(
          `Acceptance criterion #${i + 1} must have non-empty id and description.`,
        );
      } else if (item.verified !== true) {
        errors.push(`Unverified acceptance criterion: ${item.id}.`);
      }
    }
  }

  if (!manifest.assertions || typeof manifest.assertions !== "object") {
    errors.push("Missing automated verification and assertion results.");
  } else {
    const { passed, failed } = manifest.assertions;
    if (typeof passed !== "number" || !Number.isInteger(passed) || passed < 1) {
      errors.push(
        "Assertion results must include an integer passed count of at least 1.",
      );
    }
    if (
      typeof failed !== "number" ||
      !Number.isInteger(failed) ||
      failed !== 0
    ) {
      errors.push(
        `Assertion results must report failed === 0 (got ${JSON.stringify(failed)}).`,
      );
    }
  }

  if (!manifest.review || typeof manifest.review !== "object") {
    errors.push("Missing independent engineering review summary.");
  } else {
    const validReviewers = Array.isArray(manifest.review.reviewers)
      ? manifest.review.reviewers.filter((r) => isNonEmptyString(r))
      : [];
    if (validReviewers.length === 0) {
      errors.push(
        "Independent review must list at least one non-empty independent reviewer/review pass.",
      );
    }
    if (manifest.review.soleAuthorReview !== false) {
      errors.push(
        "Independent review must set soleAuthorReview: false (implementing agent must not be the sole reviewer).",
      );
    }
    if (
      typeof manifest.review.blockingOpen !== "number" ||
      !Number.isInteger(manifest.review.blockingOpen) ||
      manifest.review.blockingOpen !== 0
    ) {
      errors.push(
        `Independent review must have integer blockingOpen === 0 (got ${JSON.stringify(manifest.review.blockingOpen)}).`,
      );
    }
    if (!isNonEmptyString(manifest.review.summary)) {
      errors.push("Independent review must include a non-empty summary.");
    }
  }

  if (manifest.mode === "non-demonstrable") {
    const reason = isNonEmptyString(manifest.nonDemonstrableReason)
      ? manifest.nonDemonstrableReason.trim()
      : "";
    if (reason.length < 20) {
      errors.push(
        "Non-demonstrable mode requires a specific justification (at least 20 characters).",
      );
    }
    const validArtifacts = Array.isArray(manifest.equivalentArtifacts)
      ? manifest.equivalentArtifacts.filter((a) => isNonEmptyString(a))
      : [];
    if (validArtifacts.length === 0) {
      errors.push(
        "Non-demonstrable mode requires at least one non-empty equivalent verification artifact.",
      );
    }
  } else if (manifest.mode === "video") {
    const video = manifest.video;
    if (!video || typeof video !== "object") {
      errors.push("Missing video metadata object.");
    } else {
      if (context.requireAccessibleUrl !== false) {
        const urlErr = validateVideoUrl(video.url);
        if (urlErr) errors.push(urlErr);
      }
      if (video.videoCodec !== "h264") {
        errors.push(`Video codec must be h264, got "${video.videoCodec}".`);
      }
      if (video.audioCodec !== "aac") {
        errors.push(`Audio codec must be aac, got "${video.audioCodec}".`);
      }
      if (
        typeof video.width !== "number" ||
        typeof video.height !== "number" ||
        !Number.isInteger(video.width) ||
        !Number.isInteger(video.height) ||
        video.width < 1280 ||
        video.height < 720
      ) {
        errors.push(
          `Video resolution must be integers at least 1280x720 (default 1920x1080), got ${video.width}x${video.height}.`,
        );
      }
      if (
        typeof video.fps !== "number" ||
        !Number.isInteger(video.fps) ||
        video.fps < 24
      ) {
        errors.push(
          `Video frame rate must be an integer at least 24 fps (default 30 fps), got ${video.fps}.`,
        );
      }
      if (
        typeof video.durationSeconds !== "number" ||
        !Number.isFinite(video.durationSeconds) ||
        video.durationSeconds <= 0
      ) {
        errors.push("Video durationSeconds must be a finite number > 0.");
      }
      if (
        !isNonEmptyString(video.ttsProvider) ||
        !ALLOWED_TTS.has(video.ttsProvider.trim().toLowerCase())
      ) {
        errors.push(
          `Video metadata ttsProvider must be one of: ${[...ALLOWED_TTS].join(", ")}.`,
        );
      }
      if (video.width !== 1920 || video.height !== 1080 || video.fps !== 30) {
        warnings.push(
          `Non-default video geometry (${video.width}x${video.height} @ ${video.fps} fps; default is 1920x1080 @ 30 fps).`,
        );
      }
    }
  }

  if (committedMedia.length > 0) {
    errors.push(
      `Binary recording artifacts must never be committed to the repository: ${committedMedia.join(", ")}.`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validatePrBody(body, context = {}) {
  const committedMedia = findCommittedMediaFiles(context.changedFiles);
  const extracted = extractEvidenceManifest(body);
  if (!extracted.ok) {
    const errors = [extracted.error];
    if (committedMedia.length > 0) {
      errors.push(
        `Binary recording artifacts must never be committed to the repository: ${committedMedia.join(", ")}.`,
      );
    }
    return {
      valid: false,
      errors,
      warnings: [],
      manifest: null,
      committedMedia,
    };
  }

  const result = validateEvidenceManifest(extracted.manifest, {
    ...context,
    _committedMedia: committedMedia,
  });

  // Verify the human-visible markdown (excluding hidden HTML comments) matches the metadata.
  const visible = String(extracted.visibleMarkdown ?? "").replace(
    /<!--[\s\S]*?--!?>/g,
    "",
  );
  if (
    isNonEmptyString(extracted.manifest.commitSha) &&
    !visible.includes(extracted.manifest.commitSha)
  ) {
    result.errors.push(
      "Visible PR evidence markdown must display the exact commitSha declared in metadata.",
    );
  }
  if (
    extracted.manifest.mode === "video" &&
    context.requireAccessibleUrl !== false &&
    isNonEmptyString(extracted.manifest.video?.url) &&
    !visible.includes(extracted.manifest.video.url.trim())
  ) {
    result.errors.push(
      "Visible PR evidence markdown must display the accessible video URL declared in metadata.",
    );
  }

  result.valid = result.errors.length === 0;
  return { ...result, manifest: extracted.manifest, committedMedia };
}

async function fetchLivePrAndFiles({ token, repository, pullNumber }) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const root = `https://api.github.com/repos/${repository}/pulls/${pullNumber}`;
  const prResp = await fetch(root, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!prResp.ok) {
    throw new Error(`GitHub PR metadata API returned HTTP ${prResp.status}`);
  }
  const pr = await prResp.json();
  if (!Number.isInteger(pr.changed_files) || pr.changed_files > 3000) {
    throw new Error(
      `PR changed_files (${pr.changed_files}) exceeds verifiable pagination limit (3000).`,
    );
  }

  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await fetch(`${root}/files?per_page=100&page=${page}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub PR files API returned HTTP ${response.status}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("Malformed GitHub PR files response.");
    }
    files.push(...batch);
    if (batch.length < 100) break;
  }

  if (files.length !== pr.changed_files) {
    throw new Error(
      `Incomplete PR file list: fetched ${files.length}, expected ${pr.changed_files}.`,
    );
  }

  const verifyResp = await fetch(root, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!verifyResp.ok) {
    throw new Error("Could not revalidate live PR revision.");
  }
  const latest = await verifyResp.json();
  if (
    latest.head?.sha !== pr.head?.sha ||
    latest.changed_files !== pr.changed_files
  ) {
    throw new Error(
      "PR changed while fetching files; rerun check against latest commit.",
    );
  }

  return { pr: latest, files };
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--manifest") {
      args.manifest = requireValue(argv, i, token);
      i += 1;
    } else if (token === "--pr-body-file") {
      args.prBodyFile = requireValue(argv, i, token);
      i += 1;
    } else if (token === "--head-sha") {
      args.headSha = requireValue(argv, i, token);
      i += 1;
    } else if (token === "--branch") {
      args.branch = requireValue(argv, i, token);
      i += 1;
    } else if (token === "--repo") {
      args.repository = requireValue(argv, i, token);
      i += 1;
    } else if (token === "--pr") {
      const raw = requireValue(argv, i, token);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --pr number: ${raw}`);
      }
      args.pullRequest = parsed;
      i += 1;
    } else if (token === "--allow-local-video") {
      args.allowLocalVideo = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function escapeSummary(value) {
  return String(value ?? "")
    .replaceAll("`", "'")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "")
    .replaceAll("\n", " ");
}

async function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

async function runCli() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.manifest) {
    const manifest = JSON.parse(await readFile(cli.manifest, "utf8"));
    const result = validateEvidenceManifest(manifest, {
      repository: cli.repository,
      branch: cli.branch,
      headSha: cli.headSha,
      pullRequest: cli.pullRequest,
      requireAccessibleUrl: !cli.allowLocalVideo,
    });
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (!result.valid) {
      for (const error of result.errors) console.error(`Error: ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("PR video evidence manifest is valid.");
    return;
  }

  if (cli.prBodyFile) {
    const body = await readFile(cli.prBodyFile, "utf8");
    const result = validatePrBody(body, {
      repository: cli.repository,
      branch: cli.branch,
      headSha: cli.headSha,
      pullRequest: cli.pullRequest,
      requireAccessibleUrl: !cli.allowLocalVideo,
    });
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (!result.valid) {
      for (const error of result.errors) console.error(`Error: ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("PR description video evidence is valid.");
    return;
  }

  if (!process.env.GITHUB_EVENT_PATH) {
    console.error(
      "Usage: node scripts/pr-video-evidence/validate-pr.mjs --manifest <evidence.json> [--allow-local-video] | --pr-body-file <file> [--pr <num>] [--head-sha <sha>]",
    );
    process.exitCode = 1;
    return;
  }

  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const eventPr = event.pull_request;
  if (!eventPr) {
    console.log("No pull_request payload present; skipping.");
    return;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!process.env.GITHUB_TOKEN || !repository || !eventPr.number) {
    console.error(
      "Error: GITHUB_TOKEN, GITHUB_REPOSITORY, and pull_request.number are required in CI mode (fail closed).",
    );
    process.exitCode = 1;
    return;
  }

  const { pr, files } = await fetchLivePrAndFiles({
    token: process.env.GITHUB_TOKEN,
    repository,
    pullNumber: eventPr.number,
  });

  const result = validatePrBody(pr.body ?? "", {
    repository,
    branch: pr.head?.ref,
    headSha: pr.head?.sha,
    pullRequest: pr.number,
    changedFiles: files,
    requireAccessibleUrl: true,
  });

  const statusLabel = result.valid ? "PASS" : "FAIL";
  const summary = [
    "## PR Video Evidence Check",
    "",
    `- **PR:** #${pr.number} (${pr.draft ? "Draft" : "Ready for review"})`,
    `- **Branch:** \`${escapeSummary(pr.head?.ref)}\``,
    `- **HEAD SHA:** \`${escapeSummary(pr.head?.sha)}\``,
    `- **Status:** ${statusLabel}`,
    "",
  ];

  if (result.errors.length > 0) {
    summary.push("### Validation issues", "");
    for (const error of result.errors) {
      summary.push(`- ${escapeSummary(error)}`);
    }
    summary.push("");
  }
  if (result.warnings.length > 0) {
    summary.push("### Warnings", "");
    for (const warning of result.warnings) {
      summary.push(`- ${escapeSummary(warning)}`);
    }
    summary.push("");
  }

  await writeSummary(summary);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);

  if (result.valid) {
    console.log(
      `PR #${pr.number} video evidence validated for commit ${pr.head?.sha}.`,
    );
    return;
  }

  // Always fail closed when evidence is missing, stale, incomplete, or contains binary commits
  // (avoids marking an unverified Draft PR green before ready_for_review).
  for (const error of result.errors) console.error(`Error: ${error}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runCli();
}
