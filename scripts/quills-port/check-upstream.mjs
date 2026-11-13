#!/usr/bin/env node
// Upstream-safety check for the Quills port.
//   git fetch https://github.com/usekaneo/kaneo.git main:refs/remotes/upstream/main
//   node scripts/quills-port/check-upstream.mjs
// Passes when upstream has no history in any fork-owned path. It also lists how often
// upstream changes each registered seam file, and fails on a Quills reference in an
// upstream file that the registry does not name.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const { upstream, forkOwned, seams } = JSON.parse(
  readFileSync(join(here, "seams.json"), "utf8"),
);
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }).trim();
let failed = false;

for (const path of forkOwned) {
  const log = git("log", upstream, "--oneline", "--", path);
  console.log(
    `${log ? "FAIL" : "ok  "} fork-owned ${path}${log ? `\n${log}` : ""}`,
  );
  if (log) failed = true;
}
for (const seam of seams) {
  const recent = git(
    "log",
    upstream,
    "--since=90 days ago",
    "--oneline",
    "--",
    seam.file,
  );
  console.log(
    `seam ${seam.file} [${seam.state}] upstream commits in 90 days: ${recent ? recent.split("\n").length : 0}`,
  );
}
const registered = new Set(seams.map((seam) => seam.file));
const owned = (file) =>
  forkOwned.some((path) => file === path || file.startsWith(`${path}/`));
const mentions = git(
  "grep",
  "-lI",
  "-i",
  "quills",
  "--",
  "apps/api",
  "packages/permissions",
  "packages/libs",
  "tests",
  ":!*.snap",
)
  .split("\n")
  .filter(Boolean);
for (const file of mentions) {
  if (owned(file) || registered.has(file)) continue;
  let inUpstream = true;
  try {
    git("cat-file", "-e", `${upstream}:${file}`);
  } catch {
    inUpstream = false;
  }
  if (!inUpstream) continue;
  console.log(`FAIL unregistered seam: ${file}`);
  failed = true;
}
// charts/ is upstream-owned and upstream changes it often, so every fork change there
// needs a registry entry: an edit under seams, a fork-added file under forkOwned. The
// quills grep above cannot see these, because a chart change never mentions Quills.
// This stays scoped to charts/ on purpose. A repo-wide version is not usable yet:
// 321 upstream-owned files already differ across the port and only 14 are registered.
const chartChanges = git(
  "diff",
  "--name-only",
  upstream,
  "HEAD",
  "--",
  "charts",
)
  .split("\n")
  .filter(Boolean);
for (const file of chartChanges) {
  if (owned(file) || registered.has(file)) continue;
  console.log(
    `FAIL unregistered chart change: ${file} (add it to seams or forkOwned)`,
  );
  failed = true;
}
console.log(`charts: ${chartChanges.length} file(s) differ from ${upstream}`);
console.log(failed ? "FAILED" : "PASSED");
process.exit(failed ? 1 : 0);
