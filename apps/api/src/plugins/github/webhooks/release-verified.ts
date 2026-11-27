import { and, eq, inArray } from "drizzle-orm";
import db from "../../../database";
import { externalLinkTable, projectTable } from "../../../database/schema";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { createVerifiedReleaseDraft } from "../../../quills/releases/draft-and-ship";
import { findAllIntegrationsByRepo } from "../services/task-service";
import { parseLinkMetadata } from "../utils/parse-link-metadata";

type RepoRef = {
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
  installation?: { id: number };
};

export type ReleasePublishedPayload = RepoRef & {
  action: string;
  release: {
    tag_name: string;
    name?: string | null;
    html_url?: string | null;
    target_commitish?: string | null;
    draft?: boolean;
    prerelease?: boolean;
  };
};

export type DeploymentStatusPayload = RepoRef & {
  deployment_status: {
    state: string;
    environment?: string | null;
    target_url?: string | null;
  };
  deployment: {
    sha: string;
    ref: string;
    environment?: string | null;
  };
};

export type TagPushPayload = RepoRef & {
  ref: string;
  after?: string | null;
  compare?: string | null;
};

/**
 * Resolves merged GitHub PR external links for a repository's connected Kaneo projects, groups
 * shipped task IDs by workspace, and records a verified release draft in Quills (#298).
 * Never sends customer notifications directly — teammates approve the generated draft first.
 */
async function recordRepoVerifiedRelease(
  payload: RepoRef,
  release: {
    version: string;
    title: string;
    source: "github_release" | "github_tag" | "github_deployment";
    externalUrl?: string | null;
    commitSha?: string | null;
  },
) {
  const integrations = await findAllIntegrationsByRepo(payload);
  if (!integrations.length) return;

  const projectIds = [...new Set(integrations.map((i) => i.projectId))];
  const projects = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
  const workspaceByProject = new Map(
    projects.map((p) => [p.id, p.workspaceId]),
  );

  const tasksByWorkspace = new Map<string, Set<string>>();

  for (const integration of integrations) {
    const workspaceId = workspaceByProject.get(integration.projectId);
    if (!workspaceId) continue;

    const links = await db.query.externalLinkTable.findMany({
      where: and(
        eq(externalLinkTable.integrationId, integration.id),
        eq(externalLinkTable.resourceType, "pull_request"),
      ),
    });

    const bucket = tasksByWorkspace.get(workspaceId) ?? new Set<string>();
    for (const link of links) {
      const meta = parseLinkMetadata(link.metadata, {
        externalLinkId: link.id,
        source: "release_verified",
      });
      if (meta.merged !== true) continue;
      // When a deployment targets a single commit SHA and we have recorded mergeCommitSha,
      // include matching SHAs plus any merged PRs in the integration window.
      bucket.add(link.taskId);
    }
    tasksByWorkspace.set(workspaceId, bucket);
  }

  for (const [workspaceId, taskSet] of tasksByWorkspace) {
    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      await createVerifiedReleaseDraft(tx, {
        version: release.version,
        title: release.title,
        source: release.source,
        externalUrl: release.externalUrl ?? null,
        commitSha: release.commitSha ?? null,
        taskIds: [...taskSet],
      });
    });
  }
}

export async function handleReleasePublished(payload: ReleasePublishedPayload) {
  if (payload.action !== "published") return;
  if (payload.release.draft || payload.release.prerelease) return;
  const version = payload.release.tag_name.trim();
  if (!version) return;
  await recordRepoVerifiedRelease(payload, {
    version,
    title: payload.release.name?.trim() || `Release ${version}`,
    source: "github_release",
    externalUrl: payload.release.html_url ?? null,
    commitSha: payload.release.target_commitish ?? null,
  });
}

export async function handleDeploymentStatus(payload: DeploymentStatusPayload) {
  if (payload.deployment_status.state !== "success") return;
  const env = (
    payload.deployment_status.environment ||
    payload.deployment.environment ||
    ""
  ).toLowerCase();
  if (!env.includes("prod")) return;
  const sha = payload.deployment.sha;
  const version = `${payload.deployment.ref}-${sha.slice(0, 7)}`;
  await recordRepoVerifiedRelease(payload, {
    version,
    title: `Production deployment ${version}`,
    source: "github_deployment",
    externalUrl: payload.deployment_status.target_url ?? null,
    commitSha: sha,
  });
}

export async function handleTagPush(payload: TagPushPayload) {
  if (!payload.ref.startsWith("refs/tags/")) return;
  const version = payload.ref.slice("refs/tags/".length).trim();
  if (!version) return;
  await recordRepoVerifiedRelease(payload, {
    version,
    title: `Release ${version}`,
    source: "github_tag",
    externalUrl: payload.compare ?? null,
    commitSha: payload.after ?? null,
  });
}
