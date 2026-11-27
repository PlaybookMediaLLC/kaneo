import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  conversationParams,
  errors as conversationErrors,
  findConversation,
} from "./conversation-model";
import { assertTeamVisible, resolveAllowedTeamIds } from "./team-scope";
import { findTicket, ticketParams } from "./ticket-view";

// Per-thread teammate presence for collision detection (#324).
// Each open thread sends a short heartbeat (`viewing` or `replying`) kept for 25 seconds in
// kv_store. Reads look up current workspace members by exact keys (index-backed, never LIKE) and exclude the caller.

const PREFIX = "support:thread-presence:";
const TTL_SECONDS = 25;

const stateSchema = z.enum(["viewing", "replying"]);
const storedSchema = z.object({
  state: stateSchema,
  updatedAt: z.string(),
});

export const threadViewerSchema = z.object({
  principalId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  state: stateSchema,
  updatedAt: responseTimestamp,
});

const viewersResponse = z.object({
  viewers: z.array(threadViewerSchema),
});

const keyFor = (kind: "c" | "t", threadId: string, principalId: string) =>
  `${PREFIX}${kind}:${threadId}:${principalId}`;

async function writeViewer(
  db: Database,
  actor: QuillsActor,
  kind: "c" | "t",
  threadId: string,
  state: z.infer<typeof stateSchema>,
) {
  const now = new Date();
  const expiresAt = sql`now() + make_interval(secs => ${TTL_SECONDS})`;
  await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: keyFor(kind, threadId, actor.principalId),
      value: { state, updatedAt: now.toISOString() },
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: {
        value: { state, updatedAt: now.toISOString() },
        expiresAt,
      },
    });
  return { ok: true as const };
}

async function listViewers(
  db: Database,
  actor: QuillsActor,
  members: readonly string[],
  kind: "c" | "t",
  threadId: string,
) {
  if (!members.length) return { viewers: [] };
  const teammates = await db
    .select({
      id: principal.id,
      displayName: principal.displayName,
      avatarUrl: principal.avatarUrl,
    })
    .from(principal)
    .where(
      and(
        inArray(principal.kaneoUserId, members),
        ne(principal.id, actor.principalId),
      ),
    );
  if (!teammates.length) return { viewers: [] };

  const byKey = new Map(
    teammates.map((teammate) => [
      keyFor(kind, threadId, teammate.id),
      teammate,
    ]),
  );
  const rows = await db
    .select({ key: kvStore.key, value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        inArray(kvStore.key, [...byKey.keys()]),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    );

  const viewers: z.input<typeof threadViewerSchema>[] = [];
  for (const row of rows) {
    const teammate = byKey.get(row.key);
    const parsed = storedSchema.safeParse(row.value);
    if (!teammate || !parsed.success) continue;
    const updatedAt = new Date(parsed.data.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) continue;
    viewers.push({
      principalId: teammate.id,
      displayName: teammate.displayName,
      avatarUrl: teammate.avatarUrl,
      state: parsed.data.state,
      updatedAt,
    });
  }
  viewers.sort((a, b) =>
    a.state === b.state
      ? (a.displayName ?? "").localeCompare(b.displayName ?? "")
      : a.state === "replying"
        ? -1
        : 1,
  );
  return { viewers };
}

const setConversationViewer = defineQuillsRoute({
  method: "put",
  path: "/conversations/{conversationId}/presence",
  operationId: "setQuillsConversationViewer",
  summary: "Report that the caller is viewing or replying to a conversation",
  description:
    "Team-only expiring marker (25 seconds) used to warn another teammate before two replies collide. Never exposed to customers.",
  action: "read",
  callerActions: true,
  params: conversationParams,
  body: z.object({ state: stateSchema }),
  response: z.object({ ok: z.literal(true) }),
  responseDescription: "Presence marker recorded",
  errors: conversationErrors,
  event: { none: "Expiring 25-second presence marker" },
  handler: async ({ db, workspaceId, actor, actions, params, body }) => {
    const allowedTeams = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const conversation = await findConversation(db, params.conversationId);
    assertTeamVisible(
      allowedTeams,
      conversation.assignedTeamId,
      "Conversation",
    );
    return writeViewer(db, actor, "c", conversation.id, body.state);
  },
});

const listConversationViewers = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/presence",
  operationId: "listQuillsConversationViewers",
  summary:
    "List other teammates currently viewing or replying to a conversation",
  description: "Team-only. Excludes the caller and expired markers.",
  action: "read",
  callerActions: true,
  params: conversationParams,
  response: viewersResponse,
  responseDescription: "Active teammates on this conversation",
  errors: conversationErrors,
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({
    db,
    workspaceId,
    actor,
    actions,
    params,
    loaded: members,
  }) => {
    const allowedTeams = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const conversation = await findConversation(db, params.conversationId);
    assertTeamVisible(
      allowedTeams,
      conversation.assignedTeamId,
      "Conversation",
    );
    return listViewers(db, actor, members, "c", conversation.id);
  },
});

const ticketErrors = { 404: "Ticket not found" };

const setTicketViewer = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/presence",
  operationId: "setQuillsTicketViewer",
  summary: "Report that the caller is viewing or replying to a ticket",
  description:
    "Team-only expiring marker (25 seconds) used to warn another teammate before two replies collide. Never exposed to customers.",
  action: "read",
  callerActions: true,
  params: ticketParams,
  body: z.object({ state: stateSchema }),
  response: z.object({ ok: z.literal(true) }),
  responseDescription: "Presence marker recorded",
  errors: ticketErrors,
  event: { none: "Expiring 25-second presence marker" },
  handler: async ({ db, workspaceId, actor, actions, params, body }) => {
    const allowedTeams = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const ticket = await findTicket(db, params.ticketId);
    assertTeamVisible(allowedTeams, ticket.assigneeTeamId, "Ticket");
    return writeViewer(db, actor, "t", ticket.id, body.state);
  },
});

const listTicketViewers = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/presence",
  operationId: "listQuillsTicketViewers",
  summary: "List other teammates currently viewing or replying to a ticket",
  description: "Team-only. Excludes the caller and expired markers.",
  action: "read",
  callerActions: true,
  params: ticketParams,
  response: viewersResponse,
  responseDescription: "Active teammates on this ticket",
  errors: ticketErrors,
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({
    db,
    workspaceId,
    actor,
    actions,
    params,
    loaded: members,
  }) => {
    const allowedTeams = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const ticket = await findTicket(db, params.ticketId);
    assertTeamVisible(allowedTeams, ticket.assigneeTeamId, "Ticket");
    return listViewers(db, actor, members, "t", ticket.id);
  },
});

/** Teammate routes for per-conversation and per-ticket collision presence (#324). */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...setConversationViewer)
  .openapi(...listConversationViewers)
  .openapi(...setTicketViewer)
  .openapi(...listTicketViewers);
