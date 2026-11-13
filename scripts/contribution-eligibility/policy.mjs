export const approvalLabel = "ready-for-contribution";
export const statusContext = "Contribution eligibility";

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new Error("Missing contribution policy.");
  }
  const ids = new Set();
  for (const key of ["vouchedContributors", "exemptBots"]) {
    if (!Array.isArray(policy[key])) {
      throw new Error(`Contribution policy must define ${key}.`);
    }
    for (const account of policy[key]) {
      if (
        !Number.isSafeInteger(account.id) ||
        account.id <= 0 ||
        typeof account.login !== "string" ||
        !account.login.trim() ||
        typeof account.reason !== "string" ||
        !account.reason.trim() ||
        ids.has(account.id)
      ) {
        throw new Error(`Invalid or duplicate account in ${key}.`);
      }
      ids.add(account.id);
    }
  }
  return policy;
}

export function authorExemption(author, permission, policy) {
  if (!Number.isSafeInteger(author?.id) || author.id <= 0) {
    throw new Error("Missing pull request author identity.");
  }
  if (author.type === "Bot") {
    return policy.exemptBots.some((account) => account.id === author.id)
      ? "Approved automation."
      : null;
  }
  if (policy.vouchedContributors.some((account) => account.id === author.id)) {
    return "Vouched contributor; an issue is optional.";
  }
  if (
    permission?.permission === "admin" ||
    permission?.permission === "maintain" ||
    permission?.role_name === "maintain"
  ) {
    return "Repository maintainer; an issue is optional.";
  }
  return null;
}

// The nightly workflow in .github/workflows/upstream-kaneo.yml opens one pull
// request from the upstream repository's main branch into staging. Its author is
// github-actions[bot], the identity every workflow shares when it uses
// GITHUB_TOKEN, so exempting that account would exempt every workflow-authored
// pull request, including one added later. Identify the sync by its head and
// base instead. The exemption then skips only the issue link, and only for a
// branch this fork already merges nightly; review and CI still apply.
export function upstreamSyncExemption(pull) {
  return pull?.head?.repo?.full_name === "usekaneo/kaneo" &&
    pull?.head?.ref === "main" &&
    pull?.base?.ref === "staging"
    ? "Upstream sync from usekaneo/kaneo:main."
    : null;
}

export function assessIssues(issues) {
  const approved = issues.find(
    (issue) =>
      !issue.pull_request &&
      issue.state === "open" &&
      issue.labels.some((label) => label.name === approvalLabel),
  );
  return approved
    ? {
        state: "success",
        description: `Linked to approved issue #${approved.number}.`,
      }
    : {
        state: "failure",
        description: `Link an open issue labeled ${approvalLabel}, or ask a maintainer to vouch for you.`,
      };
}
