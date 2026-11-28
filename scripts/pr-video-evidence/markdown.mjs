export const BLOCK_START = "<!-- pr-video-evidence:start -->";
export const BLOCK_END = "<!-- pr-video-evidence:end -->";
export const JSON_START = "<!-- pr-video-evidence:json";
export const JSON_END = "pr-video-evidence:json -->";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function sanitizeText(value) {
  return String(value ?? "")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "")
    .trim();
}

function escapeCell(value) {
  return sanitizeText(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function encodeMarkdownUrl(url) {
  return String(url ?? "")
    .trim()
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E");
}

/** Strips workstation-local absolute paths before embedding JSON into public PR descriptions. */
export function sanitizeManifestForPr(manifest) {
  const copy = structuredClone(manifest);
  if (copy.video && typeof copy.video === "object") {
    delete copy.video.path;
  }
  delete copy.artifacts;
  return copy;
}

export function formatEvidenceMarkdown(manifest) {
  const lines = [BLOCK_START, "### PR Video Evidence", ""];

  if (manifest.mode === "non-demonstrable") {
    lines.push(
      "**Mode:** Non-demonstrable (video not applicable)",
      `**Justification:** ${sanitizeText(manifest.nonDemonstrableReason)}`,
      "",
    );
  } else {
    const videoUrl = manifest.video?.url;
    const videoLink = videoUrl
      ? `[Watch narrated verification video (${formatDuration(manifest.video?.durationSeconds)})](${encodeMarkdownUrl(videoUrl)})`
      : "_Local recording generated — upload and attach an accessible `https://` URL before marking ready for review_";
    lines.push(`- **Video:** ${videoLink}`);
    if (manifest.video) {
      lines.push(
        `- **Format:** ${manifest.video.width}x${manifest.video.height} @ ${manifest.video.fps} fps, ${sanitizeText(manifest.video.videoCodec)}/${sanitizeText(manifest.video.audioCodec)}, TTS: \`${sanitizeText(manifest.video.ttsProvider)}\` (\`${sanitizeText(manifest.video.ttsVoice ?? "default")}\`)`,
      );
    }
    lines.push("");
  }

  lines.push(
    "| Field | Value |",
    "| --- | --- |",
    `| Repository | \`${escapeCell(manifest.repository)}\` |`,
    `| Branch | \`${escapeCell(manifest.branch)}\` |`,
    `| Commit | \`${escapeCell(manifest.commitSha)}\` |`,
    `| Pull request | ${manifest.pullRequest ? `#${manifest.pullRequest}` : "_pending_"} |`,
    `| Captured at | \`${escapeCell(manifest.capturedAt)}\` |`,
    `| Surface / route | \`${escapeCell(manifest.app)}\` — \`${escapeCell(manifest.route)}\` |`,
    `| Environment | ${escapeCell(manifest.environment)} |`,
    "",
  );

  if (
    Array.isArray(manifest.acceptanceCriteria) &&
    manifest.acceptanceCriteria.length > 0
  ) {
    lines.push("#### Acceptance criteria", "");
    for (const item of manifest.acceptanceCriteria) {
      const box = item.verified ? "[x]" : "[ ]";
      lines.push(
        `- ${box} **${sanitizeText(item.id)}**: ${sanitizeText(item.description)}`,
      );
    }
    lines.push("");
  }

  if (manifest.assertions) {
    lines.push(
      "#### Automated verification & assertions",
      "",
      `- Passed: **${manifest.assertions.passed ?? 0}**, Failed: **${manifest.assertions.failed ?? 0}**, Skipped: **${manifest.assertions.skipped ?? 0}**`,
    );
    if (Array.isArray(manifest.assertions.checks)) {
      for (const check of manifest.assertions.checks) {
        lines.push(
          `- \`${sanitizeText(check.command)}\` — ${sanitizeText(check.status)}`,
        );
      }
    }
    lines.push("");
  }

  if (manifest.review) {
    lines.push(
      "#### Independent engineering review",
      "",
      `- Reviewers: ${(manifest.review.reviewers ?? []).map((r) => `\`${sanitizeText(r)}\``).join(", ")}`,
      `- Blocking issues open: **${manifest.review.blockingOpen ?? 0}**`,
      `- Summary: ${sanitizeText(manifest.review.summary)}`,
      "",
    );
  }

  if (
    Array.isArray(manifest.equivalentArtifacts) &&
    manifest.equivalentArtifacts.length > 0
  ) {
    lines.push("#### Equivalent verification artifacts", "");
    for (const artifact of manifest.equivalentArtifacts) {
      lines.push(`- ${sanitizeText(artifact)}`);
    }
    lines.push("");
  }

  if (
    Array.isArray(manifest.addressedFeedback) &&
    manifest.addressedFeedback.length > 0
  ) {
    lines.push("#### Addressed review feedback", "");
    for (const entry of manifest.addressedFeedback) {
      lines.push(
        `- [${entry.status === "addressed" ? "x" : " "}] ${sanitizeText(entry.comment)} (${sanitizeText(entry.status)})`,
      );
    }
    lines.push("");
  }

  // Embed structured JSON inside an HTML comment (sanitizing local paths and comment terminators).
  const sanitized = JSON.stringify(sanitizeManifestForPr(manifest), null, 2)
    .replaceAll("-->", "--\\u003e")
    .replaceAll("--!>", "--!\\u003e");
  lines.push(JSON_START, sanitized, JSON_END, BLOCK_END);
  return lines.join("\n");
}

export function extractEvidenceManifest(body) {
  if (typeof body !== "string" || !body.trim()) {
    return { ok: false, error: "Pull request description is empty." };
  }

  const matches = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(BLOCK_START, cursor);
    if (start === -1) break;
    const end = body.indexOf(BLOCK_END, start + BLOCK_START.length);
    if (end === -1) {
      return {
        ok: false,
        error: `Unclosed ${BLOCK_START} block (missing matching ${BLOCK_END}).`,
      };
    }
    matches.push(body.slice(start + BLOCK_START.length, end));
    cursor = end + BLOCK_END.length;
  }

  if (matches.length === 0) {
    return {
      ok: false,
      error: `Missing ${BLOCK_START} ... ${BLOCK_END} block in pull request description.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Found ${matches.length} ${BLOCK_START} blocks; keep exactly one evidence block in the pull request description.`,
    };
  }

  const block = matches[0];
  const jsonStart = block.indexOf(JSON_START);
  const jsonEnd =
    jsonStart === -1
      ? -1
      : block.indexOf(JSON_END, jsonStart + JSON_START.length);
  if (jsonStart === -1 || jsonEnd === -1) {
    return {
      ok: false,
      error: `Missing ${JSON_START} ... ${JSON_END} metadata payload inside evidence block.`,
    };
  }

  const visibleMarkdown = block.slice(0, jsonStart);
  const raw = block.slice(jsonStart + JSON_START.length, jsonEnd).trim();
  try {
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return {
        ok: false,
        error: "Evidence metadata payload must be a JSON object.",
      };
    }
    return { ok: true, manifest, visibleMarkdown };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON in PR video evidence block: ${error.message}`,
    };
  }
}
