import { and, asc, eq } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  findTeammate,
  findTicket,
  notFound,
  subscribe,
  ticketParams,
} from "./ticket-view";

const errors = { 404: "Ticket or teammate not found" };
const reasons = ["requester", "assignee", "replier", "manual"] as const;
const status = z.object({
  watching: z.boolean(),
  reason: z.enum(reasons).nullable(),
  mutedUntil: nullableResponseTimestamp,
});
const personal = { none: "A watcher's own subscription is personal state." };
const own = (ticketId: TypeId<"ticket">, principalId: TypeId<"principal">) =>
  and(
    eq(ticketSubscriptions.ticketId, ticketId),
    eq(ticketSubscriptions.principalId, principalId),
  );

async function watchStatus(
  db: Database,
  ticketId: TypeId<"ticket">,
  principalId: TypeId<"principal">,
) {
  const [row] = await db
    .select({
      reason: ticketSubscriptions.reason,
      mutedUntil: ticketSubscriptions.mutedUntil,
    })
    .from(ticketSubscriptions)
    .where(own(ticketId, principalId));
  return row
    ? {
        watching: true,
        reason: row.reason as (typeof reasons)[number],
        mutedUntil: row.mutedUntil,
      }
    : { watching: false, reason: null, mutedUntil: null };
}

const getStatus = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/watch",
  operationId: "getQuillsTicketWatchStatus",
  summary: "Get the caller's watch state on a support ticket",
  action: "read",
  params: ticketParams,
  response: status,
  responseDescription: "The caller's watch state",
  errors,
  handler: async ({ db, actor, params }) => {
    await findTicket(db, params.ticketId);
    return watchStatus(db, params.ticketId, actor.principalId);
  },
});

const watch = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/watch",
  operationId: "watchQuillsTicket",
  summary: "Watch a support ticket",
  action: "read",
  params: ticketParams,
  response: status,
  responseDescription: "The caller's watch state",
  errors,
  event: personal,
  handler: async ({ db, actor, params }) => {
    await findTicket(db, params.ticketId);
    await subscribe(db, params.ticketId, actor.principalId, "manual");
    return watchStatus(db, params.ticketId, actor.principalId);
  },
});

const unwatch = defineQuillsRoute({
  method: "delete",
  path: "/tickets/{ticketId}/watch",
  operationId: "unwatchQuillsTicket",
  summary: "Stop watching a support ticket",
  action: "read",
  params: ticketParams,
  response: status,
  responseDescription: "The caller's watch state",
  errors,
  event: personal,
  handler: async ({ db, actor, params }) => {
    await findTicket(db, params.ticketId);
    await db
      .delete(ticketSubscriptions)
      .where(own(params.ticketId, actor.principalId));
    return watchStatus(db, params.ticketId, actor.principalId);
  },
});

const mute = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/mute",
  operationId: "muteQuillsTicket",
  summary: "Mute a watched support ticket for some days",
  description: "Does nothing when the caller does not watch the ticket.",
  action: "read",
  params: ticketParams,
  body: z.object({ days: z.number().int().min(1).max(30) }),
  response: status,
  responseDescription: "The caller's watch state",
  errors,
  event: personal,
  handler: async ({ db, actor, params, body }) => {
    await findTicket(db, params.ticketId);
    await db
      .update(ticketSubscriptions)
      .set({ mutedUntil: new Date(Date.now() + body.days * 86400000) })
      .where(own(params.ticketId, actor.principalId));
    return watchStatus(db, params.ticketId, actor.principalId);
  },
});

const unmute = defineQuillsRoute({
  method: "delete",
  path: "/tickets/{ticketId}/mute",
  operationId: "unmuteQuillsTicket",
  summary: "Unmute a support ticket",
  action: "read",
  params: ticketParams,
  response: status,
  responseDescription: "The caller's watch state",
  errors,
  event: personal,
  handler: async ({ db, actor, params }) => {
    await findTicket(db, params.ticketId);
    await db
      .update(ticketSubscriptions)
      .set({ mutedUntil: null })
      .where(own(params.ticketId, actor.principalId));
    return watchStatus(db, params.ticketId, actor.principalId);
  },
});

const listWatchers = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/watchers",
  operationId: "listQuillsTicketWatchers",
  summary: "List a support ticket's watchers",
  action: "read",
  params: ticketParams,
  response: z.object({
    items: z.array(
      z.object({
        principalId: z.string(),
        reason: z.enum(reasons),
        mutedUntil: nullableResponseTimestamp,
        displayName: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        teammate: z.boolean(),
      }),
    ),
  }),
  responseDescription: "The watchers",
  errors,
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    const rows = await db
      .select({
        principalId: ticketSubscriptions.principalId,
        reason: ticketSubscriptions.reason,
        mutedUntil: ticketSubscriptions.mutedUntil,
        displayName: principal.displayName,
        avatarUrl: principal.avatarUrl,
        kaneoUserId: principal.kaneoUserId,
      })
      .from(ticketSubscriptions)
      .innerJoin(principal, eq(principal.id, ticketSubscriptions.principalId))
      .where(eq(ticketSubscriptions.ticketId, params.ticketId))
      .orderBy(asc(ticketSubscriptions.createdAt))
      // ponytail: one ticket's watchers; page it if a ticket ever gathers hundreds.
      .limit(500);
    return {
      items: rows.map(({ kaneoUserId, ...row }) => ({
        ...row,
        reason: row.reason as (typeof reasons)[number],
        teammate: kaneoUserId !== null,
      })),
    };
  },
});

const watcherParams = ticketParams.extend({
  principalId: flexibleToTypeIdSchema("principal"),
});
const changed = z.object({ changed: z.boolean() });

const addWatcher = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/watchers/{principalId}",
  operationId: "addQuillsTicketWatcher",
  summary: "Add a teammate as a support ticket watcher",
  description: "Only a current member of the workspace can be added.",
  action: "update",
  params: watcherParams,
  response: changed,
  responseDescription: "Whether a watcher was added",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.watcher_added",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { principalId: params.principalId },
    },
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({ db, params, loaded }) => {
    await findTicket(db, params.ticketId);
    await findTeammate(db, loaded, params.principalId);
    const rows = await subscribe(
      db,
      params.ticketId,
      params.principalId,
      "manual",
    ).returning({ id: ticketSubscriptions.id });
    return { changed: rows.length > 0 };
  },
});

const removeWatcher = defineQuillsRoute({
  method: "delete",
  path: "/tickets/{ticketId}/watchers/{principalId}",
  operationId: "removeQuillsTicketWatcher",
  summary: "Remove a support ticket watcher",
  action: "update",
  params: watcherParams,
  response: changed,
  responseDescription: "Whether a watcher was removed",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.watcher_removed",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { principalId: params.principalId },
    },
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    const [watcher] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, params.principalId));
    if (!watcher) throw notFound("Watcher");
    const rows = await db
      .delete(ticketSubscriptions)
      .where(own(params.ticketId, params.principalId))
      .returning({ id: ticketSubscriptions.id });
    return { changed: rows.length > 0 };
  },
});

/** Teammate routes for ticket watchers: the caller's own watch and mute, and managed watchers. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getStatus)
  .openapi(...watch)
  .openapi(...unwatch)
  .openapi(...mute)
  .openapi(...unmute)
  .openapi(...listWatchers)
  .openapi(...addWatcher)
  .openapi(...removeWatcher);
