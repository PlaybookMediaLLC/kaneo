import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { integrationEventMappings as mappings } from "../../database/quills/schema/integrations";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { deliveredEvent, provider } from "./catalog";
import { checkEvents, findIntegration, integrationParams } from "./connect";
import { oauthProvider, validTarget } from "./providers";

/** The target of the mappings that a webhook provider sends to its own connection. */
export const DEFAULT_TARGET = "default";
export const eventState = z.object({
  eventType: z.string(),
  enabled: z.boolean(),
});
export const channelView = z
  .object({
    channel: z.string(),
    events: z.array(eventState),
    boardIds: z.array(z.string()).nullable(),
  })
  .openapi("QuillsIntegrationChannel");
type Channel = z.output<typeof channelView>;
export const mappingColumns = {
  eventType: mappings.eventType,
  enabled: mappings.enabled,
  targetKey: mappings.targetKey,
  filters: mappings.filters,
};

/** Groups mapping rows by target. The default target is not a channel. */
export function channelsOf(
  rows: {
    eventType: string;
    enabled: boolean;
    targetKey: string;
    filters: { boardIds?: string[] } | null;
  }[],
) {
  const found = new Map<string, Channel>();
  for (const row of rows) {
    if (row.targetKey === DEFAULT_TARGET) continue;
    const entry = found.get(row.targetKey) ?? {
      channel: row.targetKey,
      events: [],
      boardIds: row.filters?.boardIds?.length ? row.filters.boardIds : null,
    };
    entry.events.push({ eventType: row.eventType, enabled: row.enabled });
    found.set(row.targetKey, entry);
  }
  return [...found.values()];
}

// A target inside the provider account, such as a Shortcut group ID or an Azure DevOps project and
// work item type. Never a URL: no path separator, query, fragment, percent sign or control character.
// A provider in providers/ also checks its own rule (`target`) when a channel is added.
const channel = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^/\\?#%]+$/)
  .refine((value) => !/\p{Cc}/u.test(value), "No control characters")
  .openapi({
    description:
      "A target in the provider account, such as a Shortcut group ID or `Project:Bug` for Azure DevOps",
  });
/** The channel rule of a provider in providers/; the other providers (Shortcut) keep the earlier pattern. */
const allowedChannel = (type: string, target: string) =>
  oauthProvider(type)
    ? validTarget(type, target)
    : /^[A-Za-z0-9_.:-]{1,100}$/.test(target);
const channelParams = integrationParams.extend({ channel });
const boardIds = z.array(flexibleToTypeIdSchema("board")).max(50);
const response = z.object({ channel: channelView });
const errors = {
  403: "Insufficient permission",
  404: "Integration or channel not found",
  409: "This integration sends to its connection and has no channels",
};
const notFound = () => new HTTPException(404, { message: "Channel not found" });

/** Every board filter must be a live board of this workspace. */
async function liveBoards(
  db: Database,
  ids: TypeId<"board">[] | null | undefined,
) {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return null;
  const [found] = await db
    .select({ n: count() })
    .from(boards)
    .where(and(inArray(boards.id, unique), isNull(boards.deletedAt)));
  if (found!.n !== unique.length)
    throw new HTTPException(404, { message: "Board not found" });
  return unique;
}

/** A connection that accepts channels, and a target that is not the connection itself. */
async function channelIntegration(
  db: Database,
  id: TypeId<"integration">,
  target: string,
) {
  const integration = await findIntegration(db, id);
  if (!provider(integration.integrationType)?.channels)
    throw new HTTPException(409, { message: errors[409] });
  if (target === DEFAULT_TARGET) throw notFound();
  return integration;
}

async function readChannel(
  db: Database,
  integrationId: TypeId<"integration">,
  target: string,
) {
  const rows = await db
    .select(mappingColumns)
    .from(mappings)
    .where(
      and(
        eq(mappings.integrationId, integrationId),
        eq(mappings.targetKey, target),
      ),
    )
    .orderBy(mappings.eventType);
  const [found] = channelsOf(rows);
  if (!found) throw notFound();
  return found;
}

/** Sets event mappings for one target. One row per event type: the last entry wins. */
export async function upsert(
  db: Database,
  integrationId: TypeId<"integration">,
  target: string,
  events: { eventType: string; enabled: boolean }[],
  filter: string[] | null,
) {
  const wanted = [
    ...new Map(events.map((event) => [event.eventType, event])).values(),
  ];
  await db
    .insert(mappings)
    .values(
      wanted.map((event) => ({
        integrationId,
        eventType: event.eventType,
        actionType: "send_message",
        targetKey: target,
        filters: filter && { boardIds: filter },
        enabled: event.enabled,
      })),
    )
    .onConflictDoUpdate({
      target: [
        mappings.workspaceId,
        mappings.actionType,
        mappings.eventType,
        mappings.integrationId,
        mappings.targetKey,
      ],
      set: {
        enabled: sql`excluded.enabled`,
        filters: sql`excluded.filters`,
        updatedAt: new Date(),
      },
    });
}

const channelEvent =
  (
    type:
      | "integration.channel_added"
      | "integration.channel_updated"
      | "integration.channel_removed",
  ) =>
  (
    input: { params: { integrationId: string } },
    result: { channel: { channel: string } },
  ) => ({
    type,
    entityType: "integration" as const,
    entityId: input.params.integrationId,
    payload: { channel: result.channel.channel },
  });

const addChannel = defineQuillsRoute({
  method: "post",
  path: "/integrations/{integrationId}/channels",
  operationId: "addQuillsNotificationChannel",
  summary: "Add a notification channel to an integration",
  description:
    "Maps event types to one target in the provider account. Adding an existing channel enables the listed events and replaces its board filter.",
  action: "manage_settings",
  params: integrationParams,
  body: z.object({
    channel,
    events: z.array(deliveredEvent).min(1).max(20),
    boardIds: boardIds.optional(),
  }),
  response,
  responseDescription: "The channel",
  errors: {
    ...errors,
    400: "An event the provider does not deliver, or a channel that is not a valid target for it",
  },
  event: channelEvent("integration.channel_added"),
  handler: async ({ db, params, body }) => {
    const integration = await channelIntegration(
      db,
      params.integrationId,
      body.channel,
    );
    if (!allowedChannel(integration.integrationType, body.channel))
      throw new HTTPException(400, {
        message: "This channel is not a valid target for the integration.",
      });
    checkEvents(integration.integrationType, body.events);
    const filter = await liveBoards(db, body.boardIds);
    await upsert(
      db,
      params.integrationId,
      body.channel,
      [...new Set(body.events)].map((eventType) => ({
        eventType,
        enabled: true,
      })),
      filter,
    );
    return {
      channel: await readChannel(db, params.integrationId, body.channel),
    };
  },
});

const updateChannel = defineQuillsRoute({
  method: "patch",
  path: "/integrations/{integrationId}/channels/{channel}",
  operationId: "updateQuillsNotificationChannel",
  summary: "Update a notification channel",
  description:
    "Sets the listed events on or off. A `boardIds` value replaces the board filter of every event of the channel; null removes it.",
  action: "manage_settings",
  params: channelParams,
  body: z.object({
    events: z
      .array(z.object({ eventType: deliveredEvent, enabled: z.boolean() }))
      .min(1)
      .max(20),
    boardIds: boardIds.nullable().optional(),
  }),
  response,
  responseDescription: "The channel",
  errors,
  event: channelEvent("integration.channel_updated"),
  handler: async ({ db, params, body }) => {
    const integration = await channelIntegration(
      db,
      params.integrationId,
      params.channel,
    );
    const current = await readChannel(db, params.integrationId, params.channel);
    checkEvents(
      integration.integrationType,
      body.events.map((event) => event.eventType),
    );
    const filter =
      body.boardIds === undefined
        ? current.boardIds
        : await liveBoards(db, body.boardIds);
    await upsert(db, params.integrationId, params.channel, body.events, filter);
    await db
      .update(mappings)
      .set({ filters: filter && { boardIds: filter }, updatedAt: new Date() })
      .where(
        and(
          eq(mappings.integrationId, params.integrationId),
          eq(mappings.targetKey, params.channel),
        ),
      );
    return {
      channel: await readChannel(db, params.integrationId, params.channel),
    };
  },
});

const removeChannel = defineQuillsRoute({
  method: "delete",
  path: "/integrations/{integrationId}/channels/{channel}",
  operationId: "removeQuillsNotificationChannel",
  summary: "Remove a notification channel",
  description: "Removes every event mapping of the channel.",
  action: "manage_settings",
  params: channelParams,
  response: z.object({ channel: z.object({ channel: z.string() }) }),
  responseDescription: "Channel removed",
  errors,
  event: channelEvent("integration.channel_removed"),
  handler: async ({ db, params }) => {
    await channelIntegration(db, params.integrationId, params.channel);
    const removed = await db
      .delete(mappings)
      .where(
        and(
          eq(mappings.integrationId, params.integrationId),
          eq(mappings.targetKey, params.channel),
        ),
      )
      .returning({ id: mappings.id });
    if (!removed.length) throw notFound();
    return { channel: { channel: params.channel } };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...addChannel)
  .openapi(...updateChannel)
  .openapi(...removeChannel);
