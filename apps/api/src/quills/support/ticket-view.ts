// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { companies } from "../../database/quills/schema/companies";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { teams } from "../../database/quills/schema/teams";
import { ticketActivity } from "../../database/quills/schema/ticket-activity";
import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import { readSettingsKey } from "../feedback/settings-json";
import type { Database } from "../framework/define-route";

export type TicketRow = typeof tickets.$inferSelect;
type Stage = NonNullable<(typeof ticketStatuses.$inferSelect)["publicStage"]>;

export const STAGES = ticketStatuses.publicStage.enumValues;
export const PRIORITIES = tickets.priority.enumValues;
export const TICKET_KINDS = tickets.type.enumValues;
export const CATEGORIES = ticketStatuses.category.enumValues;
export const DEFAULT_STAGE_LABELS: Record<Stage, string> = {
  received: "Received",
  in_progress: "In progress",
  awaiting_requester: "Awaiting your reply",
  resolved: "Resolved",
};
export const STAGE_LABELS_KEY = "ticketStageLabels";

export const ticketParams = z.object({
  ticketId: flexibleToTypeIdSchema("ticket"),
});
export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

/** Requester-facing labels: saved labels over the defaults. A malformed saved value reads as unset. */
export async function stageLabels(db: Database) {
  const saved = await readSettingsKey(db, "metadata", STAGE_LABELS_KEY);
  const labels = { ...DEFAULT_STAGE_LABELS };
  if (saved && typeof saved === "object")
    for (const stage of STAGES) {
      const value = (saved as Record<string, unknown>)[stage];
      if (typeof value === "string" && value.trim() && value.length <= 60)
        labels[stage] = value.trim();
    }
  return labels;
}

/** A live ticket of this workspace. `lock` holds the row until the transaction ends. */
export async function findTicket(
  db: Database,
  id: TypeId<"ticket">,
  lock = false,
) {
  const query = db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("Ticket");
  return row;
}

/**
 * A live ticket status, locked. A ticket move takes a share lock, which waits for a concurrent
 * delete, so a ticket never lands on a status that is being deleted. An edit takes `update`.
 */
export async function findStatus(
  db: Database,
  id: TypeId<"ticket_status">,
  mode: "share" | "update" = "share",
) {
  const [row] = await db
    .select()
    .from(ticketStatuses)
    .where(and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)))
    .limit(1)
    .for(mode);
  if (!row) throw notFound("Ticket status");
  return row;
}

/** A teammate principal whose Kaneo user is a current member of this workspace. */
export async function findTeammate(
  db: Database,
  members: readonly string[],
  id: TypeId<"principal">,
) {
  const [row] = members.length
    ? await db
        .select({ id: principal.id, displayName: principal.displayName })
        .from(principal)
        .where(
          and(
            eq(principal.id, id),
            inArray(principal.kaneoUserId, [...members]),
          ),
        )
        .limit(1)
    : [];
  if (!row) throw notFound("Teammate");
  return row;
}

/** A live team of this workspace. */
export async function findTeam(db: Database, id: TypeId<"team">) {
  const [row] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Team");
  return row;
}

/** The conversation that shares a customer ticket's thread, or null. */
export async function pairConversationId(
  db: Database,
  ticketId: TypeId<"ticket">,
) {
  const [row] = await db
    .select({ id: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, "customer"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export const recordActivity = (
  db: Database,
  ticketId: TypeId<"ticket">,
  principalId: TypeId<"principal">,
  type: string,
  metadata: Record<string, string | null> = {},
) =>
  db.insert(ticketActivity).values({ ticketId, principalId, type, metadata });

/** Adds a watcher. An existing subscription keeps its reason and mute. */
export const subscribe = (
  db: Database,
  ticketId: TypeId<"ticket">,
  principalId: TypeId<"principal">,
  reason: "requester" | "assignee" | "replier" | "manual",
) =>
  db
    .insert(ticketSubscriptions)
    .values({ ticketId, principalId, reason })
    .onConflictDoNothing();

/** A customer-visible system line on the ticket thread: the pair's conversation, else the ticket. */
export async function systemMessage(
  db: Database,
  ticketId: TypeId<"ticket">,
  content: string,
  systemEvent: NonNullable<
    (typeof conversationMessages.$inferInsert)["metadata"]
  >["systemEvent"],
  internal = false,
) {
  const conversationId = internal
    ? null
    : await pairConversationId(db, ticketId);
  await db.insert(conversationMessages).values({
    ...(conversationId ? { conversationId } : { ticketId }),
    principalId: null,
    senderType: "system",
    content,
    isInternal: internal,
    metadata: { systemEvent },
  });
}

const attributeValue = z
  .union([z.string(), z.number(), z.boolean()])
  .nullable();

export const ticketSchema = z
  .object({
    id: z.string(),
    number: z.number(),
    reference: z.string(),
    type: z.enum(TICKET_KINDS),
    ticketType: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        category: z.enum(TICKET_KINDS),
        icon: z.string().nullable(),
        color: z.string(),
      })
      .nullable(),
    title: z.string(),
    status: z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      category: z.enum(CATEGORIES),
    }),
    stage: z.object({
      slot: z.enum(STAGES).nullable(),
      label: z.string().nullable(),
      closed: z.boolean(),
    }),
    priority: z.enum(PRIORITIES),
    requester: z
      .object({
        principalId: z.string(),
        displayName: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      })
      .nullable(),
    assignee: z.object({
      principalId: z.string().nullable(),
      displayName: z.string().nullable(),
      teamId: z.string().nullable(),
      teamName: z.string().nullable(),
    }),
    company: z.object({ id: z.string(), name: z.string() }).nullable(),
    customAttributes: z.array(
      z.object({ key: z.string(), value: attributeValue }),
    ),
    firstResponseAt: nullableResponseTimestamp,
    dueAt: nullableResponseTimestamp,
    resolvedAt: nullableResponseTimestamp,
    reopenedCount: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsTicket");
export type TicketView = z.input<typeof ticketSchema>;

const byId = <T extends { id: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.id as string, row]));
const unique = <T>(values: (T | null)[]) => [
  ...new Set(values.filter((v): v is T => v !== null)),
];

/** Custom attributes as key/value pairs. A nested value is returned as its JSON text. */
const attributes = (value: unknown) =>
  Object.entries(
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
  ).map(([key, item]) => ({
    key,
    value:
      item === null || ["string", "number", "boolean"].includes(typeof item)
        ? (item as string | number | boolean | null)
        : JSON.stringify(item),
  }));

/** The teammate view of tickets, in the order given. Reads only this workspace through the scoped handle. */
export async function ticketViews(
  db: Database,
  rows: TicketRow[],
): Promise<TicketView[]> {
  if (!rows.length) return [];
  const statusIds = unique(rows.map((r) => r.statusId));
  const typeIds = unique(rows.map((r) => r.ticketTypeId));
  const principalIds = unique(
    rows.flatMap((r) => [r.requesterPrincipalId, r.assigneePrincipalId]),
  );
  const teamIds = unique(rows.map((r) => r.assigneeTeamId));
  const companyIds = unique(rows.map((r) => r.companyId));
  const statuses = byId(
    await db
      .select()
      .from(ticketStatuses)
      .where(inArray(ticketStatuses.id, statusIds)),
  );
  const types = byId(
    typeIds.length
      ? await db
          .select({
            id: ticketTypes.id,
            name: ticketTypes.name,
            slug: ticketTypes.slug,
            category: ticketTypes.category,
            icon: ticketTypes.icon,
            color: ticketTypes.color,
          })
          .from(ticketTypes)
          .where(inArray(ticketTypes.id, typeIds))
      : [],
  );
  const people = byId(
    principalIds.length
      ? await db
          .select({
            id: principal.id,
            displayName: principal.displayName,
            avatarUrl: principal.avatarUrl,
          })
          .from(principal)
          .where(inArray(principal.id, principalIds))
      : [],
  );
  const teamNames = byId(
    teamIds.length
      ? await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [],
  );
  const companyNames = byId(
    companyIds.length
      ? await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : [],
  );
  const labels = await stageLabels(db);
  return rows.map((row) => {
    const status = statuses.get(row.statusId);
    const slot = status?.publicStage ?? null;
    const requester = row.requesterPrincipalId
      ? people.get(row.requesterPrincipalId)
      : undefined;
    return {
      id: row.id,
      number: row.number,
      reference: `#${row.number}`,
      type: row.type,
      ticketType: row.ticketTypeId
        ? (types.get(row.ticketTypeId) ?? null)
        : null,
      title: row.title,
      status: status
        ? {
            id: status.id,
            name: status.name,
            color: status.color,
            category: status.category,
          }
        : {
            id: row.statusId,
            name: "Unknown",
            color: "#6b7280",
            category: "open",
          },
      stage: {
        slot,
        label: slot ? labels[slot] : null,
        closed: status?.category === "closed",
      },
      priority: row.priority,
      requester: row.requesterPrincipalId
        ? {
            principalId: row.requesterPrincipalId,
            displayName: requester?.displayName ?? null,
            avatarUrl: requester?.avatarUrl ?? null,
          }
        : null,
      assignee: {
        principalId: row.assigneePrincipalId,
        displayName: row.assigneePrincipalId
          ? (people.get(row.assigneePrincipalId)?.displayName ?? null)
          : null,
        teamId: row.assigneeTeamId,
        teamName: row.assigneeTeamId
          ? (teamNames.get(row.assigneeTeamId)?.name ?? null)
          : null,
      },
      company: row.companyId
        ? {
            id: row.companyId,
            name: companyNames.get(row.companyId)?.name ?? "Unknown",
          }
        : null,
      customAttributes: attributes(row.customAttributes),
      firstResponseAt: row.firstResponseAt,
      dueAt: row.dueAt,
      resolvedAt: row.resolvedAt,
      reopenedCount: row.reopenedCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function ticketView(db: Database, row: TicketRow) {
  return (await ticketViews(db, [row]))[0]!;
}

/** Live ticket count for a status, used before a status leaves the catalogue. */
export const ticketsOnStatus = async (
  db: Database,
  statusId: TypeId<"ticket_status">,
) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.statusId, statusId), isNull(tickets.deletedAt)))
  )[0]!.n;
