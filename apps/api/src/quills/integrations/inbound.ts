import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { isTypeId } from "@kaneo/ids";
import { apiRouter, z } from "../../openapi";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { integrations } from "../../database/quills/schema/integrations";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../framework/define-route";
import { integrationWebhook, replayHorizon } from "../framework/signed";

// POST /quills-public/signed/integrations/{type}/{integrationId}/webhook: GitHub and GitLab issue
// events for status sync. framework/signed.ts checks the signature with the integration's sealed
// webhook secret; the workspace is that integration's. A closed or reopened issue moves each post
// linked to it to the mapped status. Events older than the replay horizon, or older than the last
// state the link recorded, change nothing.

const issueEvent = z.object({
  // GitHub `issues`
  action: z.string().max(50).optional(),
  issue: z
    .object({
      number: z.number().int().positive(),
      updated_at: z.string().max(64).optional(),
    })
    .optional(),
  // GitLab also sends `repository`, without full_name.
  repository: z
    .object({ full_name: z.string().max(300).optional() })
    .optional(),
  // GitLab `Issue Hook`
  object_kind: z.string().max(50).optional(),
  object_attributes: z
    .object({
      iid: z.number().int().positive(),
      action: z.string().max(50).optional(),
      updated_at: z.string().max(64).optional(),
    })
    .optional(),
  project: z.object({ id: z.number().int().positive() }).optional(),
});
type IssueEvent = z.output<typeof issueEvent>;

/** The issue and its new state, or null for an event that is not a close or a reopen. */
function statusChange(type: string, event: IssueEvent) {
  if (type === "github" && event.issue && event.repository?.full_name) {
    if (event.action !== "closed" && event.action !== "reopened") return null;
    return {
      externalId: `${event.repository.full_name}#${event.issue.number}`,
      status: event.action === "closed" ? "Closed" : "Open",
      at: event.issue.updated_at,
    };
  }
  const issue = event.object_attributes;
  if (
    type === "gitlab" &&
    event.object_kind === "issue" &&
    issue &&
    event.project
  ) {
    if (issue.action !== "close" && issue.action !== "reopen") return null;
    return {
      externalId: `${event.project.id}#${issue.iid}`,
      status: issue.action === "close" ? "closed" : "opened",
      at: issue.updated_at,
    };
  }
  return null;
}

const receive = defineQuillsRoute({
  audience: "signed",
  verifier: integrationWebhook,
  method: "post",
  path: "/integrations/{type}/{integrationId}/webhook",
  operationId: "receiveQuillsIntegrationWebhook",
  summary: "Receive a GitHub or GitLab issue event for status sync",
  description:
    "GitHub signs the body (X-Hub-Signature-256); GitLab sends the secret (X-Gitlab-Token). A repeated delivery changes nothing.",
  action: "update",
  params: z.object({
    type: z.enum(["github", "gitlab"]),
    integrationId: z.string().regex(/^integration_[0-9a-z]{26}$/),
  }),
  body: issueEvent,
  response: z.object({
    applied: z.number(),
    duplicate: z.boolean(),
    changed: z.array(z.object({ postId: z.string(), statusId: z.string() })),
  }),
  responseDescription: "How many linked posts changed status",
  replay: { applied: 0, duplicate: true, changed: [] },
  event: (_input, result) =>
    result.changed.length > 0 &&
    result.changed.map((change) => ({
      type: "post.status_changed" as const,
      entityType: "post" as const,
      entityId: change.postId,
      payload: { statusId: change.statusId, source: "integration" },
    })),
  handler: async ({ db, params, body, credential }) => {
    const none = { applied: 0, duplicate: false, changed: [] };
    // Health telemetry at most once a minute: a burst of ignored events does not queue on the row lock.
    await db
      .update(integrations)
      .set({ lastInboundAt: new Date() })
      .where(
        and(
          eq(integrations.id, credential.integrationId),
          or(
            isNull(integrations.lastInboundAt),
            lt(integrations.lastInboundAt, sql`now() - interval '1 minute'`),
          ),
        ),
      );
    const change = statusChange(params.type, body);
    if (!change) return none;
    const parsed = change.at ? new Date(change.at) : new Date();
    const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    // Older than the receipts: possibly a replay that the receipt store forgot.
    if (at < replayHorizon()) return none;
    const mapped = (
      credential.config.statusMappings as Record<string, unknown> | undefined
    )?.[change.status];
    const [status] =
      typeof mapped === "string" && isTypeId(mapped, "post_status")
        ? await db
            .select({ id: postStatuses.id })
            .from(postStatuses)
            .where(
              and(eq(postStatuses.id, mapped), isNull(postStatuses.deletedAt)),
            )
        : [];
    const links = await db
      .select({
        id: postExternalLinks.id,
        postId: postExternalLinks.postId,
        remoteStateAt: postExternalLinks.remoteStateAt,
      })
      .from(postExternalLinks)
      .where(
        and(
          eq(postExternalLinks.integrationId, credential.integrationId),
          eq(postExternalLinks.externalId, change.externalId),
          eq(postExternalLinks.status, "active"),
        ),
      )
      .limit(50)
      .for("update");
    const changed: { postId: string; statusId: string }[] = [];
    for (const link of links) {
      // Out of order: the link already holds a newer remote state.
      if (link.remoteStateAt && link.remoteStateAt >= at) continue;
      await db
        .update(postExternalLinks)
        .set({ remoteState: change.status, remoteStateAt: at })
        .where(eq(postExternalLinks.id, link.id));
      if (!status) continue;
      const [post] = await db
        .update(posts)
        .set({ statusId: status.id, updatedAt: new Date() })
        .where(
          and(
            eq(posts.id, link.postId),
            isNull(posts.deletedAt),
            or(isNull(posts.statusId), ne(posts.statusId, status.id)),
          ),
        )
        .returning({ id: posts.id });
      if (post) changed.push({ postId: post.id, statusId: status.id });
    }
    return { applied: changed.length, duplicate: false, changed };
  },
});

export default apiRouter().openapi(...receive);
