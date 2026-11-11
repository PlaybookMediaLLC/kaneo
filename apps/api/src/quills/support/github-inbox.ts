import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { channelAccounts } from "../../database/quills/schema/channel-accounts";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { integrations } from "../../database/quills/schema/integrations";
import { teams } from "../../database/quills/schema/teams";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
} from "../framework/integration-config";
import { githubRepo } from "../integrations/oauth-providers";
import { findConversation } from "./conversation-model";
import { findMessage } from "./message-model";

// The GitHub inbox channel. On: a live `connection` channel account names the GitHub integration,
// the status-sync webhook also sends `issue_comment`, the signed webhook stores issues and comments
// as conversations (github-ingest.ts), and the quills.webhook worker posts agent replies as issue
// comments (jobs/handlers/github-comment.ts). The webhook update is the only provider call here; it
// runs in `call`, with no transaction open.

const conflict = (message: string) => new HTTPException(409, { message });
const status = z.object({
  connected: z.boolean(),
  status: z.string().nullable(),
  inboxEnabled: z.boolean(),
  hasToken: z.boolean(),
  webhookReady: z.boolean(),
  repo: z.string().nullable(),
  username: z.string().nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
});
type Sync = { target?: unknown; hookId?: unknown; state?: unknown };

async function read(db: Database) {
  const [row] = await db
    .select({
      id: integrations.id,
      status: integrations.status,
      config: integrations.config,
      secrets: integrations.secrets,
      lastError: integrations.lastError,
      lastErrorAt: integrations.lastErrorAt,
      lastOutboundAt: integrations.lastOutboundAt,
      lastInboundAt: integrations.lastInboundAt,
    })
    .from(integrations)
    .where(eq(integrations.integrationType, "github"));
  const [account] = await db
    .select({ id: channelAccounts.id, config: channelAccounts.config })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channel, "github"),
        eq(channelAccounts.role, "connection"),
        isNull(channelAccounts.deletedAt),
      ),
    )
    .limit(1);
  const sync = (row?.config as { statusSync?: Sync } | undefined)?.statusSync;
  const token = openCredentials(row?.secrets ?? null)?.accessToken;
  // The webhook update names the hook and the repository in the provider path.
  const hook =
    sync?.state === "active" &&
    typeof sync.hookId === "string" &&
    /^\d{1,20}$/.test(sync.hookId) &&
    typeof sync.target === "string"
      ? { hookId: sync.hookId, repo: githubRepo(sync.target) }
      : null;
  const inbox = account?.config.integrationId === row?.id ? account : undefined;
  const login = (row?.config as { account?: unknown } | undefined)?.account;
  return {
    row,
    inbox,
    token,
    hook,
    view: {
      connected: row?.status === "active" || row?.status === "paused",
      status: row?.status ?? null,
      inboxEnabled: Boolean(inbox),
      hasToken: Boolean(token),
      webhookReady: Boolean(hook),
      repo: hook?.repo ?? null,
      username: typeof login === "string" ? login : null,
      lastError:
        row?.lastError ??
        (inbox && !token
          ? "GitHub is not connected. Connect GitHub to send comments."
          : null),
      lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      lastOutboundAt: row?.lastOutboundAt?.toISOString() ?? null,
      lastInboundAt: row?.lastInboundAt?.toISOString() ?? null,
    },
  };
}

const getStatus = defineQuillsRoute({
  method: "get",
  path: "/channels/github",
  operationId: "getQuillsGitHubChannelStatus",
  summary: "Get the GitHub inbox channel status",
  description:
    "The connection, whether the inbox is on, and its last errors. `hasToken` says whether a token is stored; the token is never returned.",
  action: "manage_settings",
  response: status,
  responseDescription: "The GitHub channel status",
  allowKeys: ["hasToken"],
  handler: async ({ db }) => (await read(db)).view,
});

const setInbox = defineQuillsRoute({
  method: "put",
  path: "/channels/github/inbox",
  operationId: "setQuillsGitHubInboxEnabled",
  summary: "Turn the GitHub inbox channel on or off",
  description:
    "The inbox uses the status-sync webhook of the GitHub connection: turn status sync on first. The webhook's events change in GitHub; when that fails the switch still changes and `lastError` says so.",
  action: "manage_settings",
  body: z.object({ enabled: z.boolean() }),
  response: status.extend({ changed: z.boolean() }),
  responseDescription: "The GitHub channel status",
  allowKeys: ["hasToken"],
  errors: {
    409: "GitHub is not connected, status sync is off, or no default team exists",
  },
  event: ({ body }, result) =>
    result.changed && {
      type: "github_inbox.settings_updated",
      entityType: "integration",
      entityId: "github",
      payload: { enabled: String(body.enabled) },
    },
  prepare: async ({ db, body }) => {
    const { row, token, hook } = await read(db);
    if (body.enabled) {
      if (row?.status === "paused")
        throw conflict("Resume GitHub before enabling the inbox channel.");
      if (row?.status !== "active" || !token)
        throw conflict("Connect GitHub before enabling the inbox channel.");
      if (!hook)
        throw conflict(
          "Turn on status sync for a repository first: the inbox uses its webhook.",
        );
    }
    return token && hook ? { token, ...hook } : null;
  },
  call: async (prepared, { body }) => {
    if (!prepared) return { updated: null };
    try {
      await providerJson(
        `https://api.github.com/repos/${prepared.repo}/hooks/${prepared.hookId}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${prepared.token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "Quills",
          },
          body: JSON.stringify({
            events: body.enabled ? ["issues", "issue_comment"] : ["issues"],
          }),
        },
      );
      return { updated: true };
    } catch (error) {
      if (error instanceof ProviderCallError) return { updated: false };
      throw error;
    }
  },
  handler: async ({ db, body, called }) => {
    const { row, inbox } = await read(db);
    if (body.enabled && row?.status !== "active")
      throw conflict("Connect GitHub before enabling the inbox channel.");
    let changed = false;
    if (body.enabled && row && !inbox) {
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.isDefault, true), isNull(teams.deletedAt)));
      if (!team) throw conflict("No default team is configured.");
      // The earlier account keeps its issue threads: restore it rather than start a new one.
      const [earlier] = await db
        .select({ id: channelAccounts.id })
        .from(channelAccounts)
        .where(
          and(
            eq(channelAccounts.owningTeamId, team.id),
            eq(channelAccounts.channel, "github"),
            eq(channelAccounts.role, "connection"),
          ),
        )
        .orderBy(sql`${channelAccounts.deletedAt} desc nulls first`)
        .limit(1)
        .for("update");
      const config = { integrationId: row.id };
      const written = earlier
        ? await db
            .update(channelAccounts)
            .set({ deletedAt: null, config, updatedAt: new Date() })
            .where(eq(channelAccounts.id, earlier.id))
            .returning({ id: channelAccounts.id })
        : await db
            .insert(channelAccounts)
            .values({
              owningTeamId: team.id,
              channel: "github",
              role: "connection",
              config,
            })
            .returning({ id: channelAccounts.id });
      changed = written.length > 0;
    }
    if (!body.enabled && inbox) {
      await db
        .update(channelAccounts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(channelAccounts.id, inbox.id));
      changed = true;
    }
    if (row && called.updated !== null)
      await db
        .update(integrations)
        .set(
          called.updated
            ? { lastError: null, lastErrorAt: null }
            : {
                lastError:
                  "The webhook update failed. Check the repository webhook in GitHub.",
                lastErrorAt: new Date(),
              },
        )
        .where(eq(integrations.id, row.id));
    return { ...(await read(db)).view, changed };
  },
});

const PENDING_STALE_MS = 10 * 60 * 1000;

const retry = defineQuillsRoute({
  method: "post",
  path: "/conversation-messages/{messageId}/github-retry",
  operationId: "retryQuillsGitHubAgentMessage",
  summary: "Send a failed reply to GitHub again",
  description:
    "For a teammate reply on a GitHub conversation whose delivery failed, or is still pending after ten minutes. The worker first looks for the comment on the issue, so a reply that reached GitHub is not posted twice.",
  action: "update",
  params: z.object({ messageId: flexibleToTypeIdSchema("conversation_msg") }),
  response: z.object({
    messageId: z.string(),
    conversationId: z.string(),
    status: z.literal("pending"),
  }),
  responseDescription: "The reply is queued for delivery",
  errors: {
    404: "Message not found",
    409: "The reply was sent, or it is still being sent",
  },
  event: ({ params }, result) => ({
    type: "github_inbox.message_retried",
    entityType: "conversation_message",
    entityId: params.messageId,
    payload: { conversationId: result.conversationId },
  }),
  handler: async ({ db, params }) => {
    const message = await findMessage(db, params.messageId);
    const conversation = await findConversation(db, message.conversationId);
    if (
      message.senderType !== "agent" ||
      message.isInternal ||
      conversation.channel !== "github"
    )
      throw new HTTPException(404, { message: "Message not found" });
    const [locked] = await db
      .select({ metadata: conversationMessages.metadata })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, message.id))
      .for("update");
    const delivery = locked?.metadata?.channelDelivery;
    const stale =
      delivery?.status === "pending" &&
      Date.parse(delivery.at) < Date.now() - PENDING_STALE_MS;
    if (locked?.metadata?.githubCommentId || delivery?.status === "sent")
      throw conflict("This reply is already on GitHub.");
    if (delivery?.status !== "failed" && !stale)
      throw conflict("This reply is still being sent.");
    await db
      .update(conversationMessages)
      .set({
        metadata: {
          ...locked!.metadata,
          channelDelivery: {
            status: "pending",
            channel: "github",
            at: new Date().toISOString(),
          },
        },
      })
      .where(eq(conversationMessages.id, message.id));
    return {
      messageId: message.id,
      status: "pending" as const,
      conversationId: conversation.id,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getStatus)
  .openapi(...setInbox)
  .openapi(...retry);
