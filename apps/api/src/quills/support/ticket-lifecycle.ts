// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { teams } from "../../database/quills/schema/teams";
import {
  ticketLinks,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  findTeam,
  findTeammate,
  recordActivity,
  stageLabels,
  subscribe,
  systemMessage,
  type TicketRow,
} from "./ticket-view";

type Status = typeof ticketStatuses.$inferSelect;
type Priority = TicketRow["priority"];

const trackedIds = async (db: Database, trackerIds: TypeId<"ticket">[]) =>
  (
    await db
      .select({ id: ticketLinks.linkedTicketId })
      .from(ticketLinks)
      .where(
        and(
          inArray(ticketLinks.trackerTicketId, trackerIds),
          eq(ticketLinks.relation, "tracks"),
        ),
      )
  ).map((r) => r.id);

const lockIds = (db: Database, ids: TypeId<"ticket">[]) =>
  ids.length
    ? db
        .select()
        .from(tickets)
        .where(and(inArray(tickets.id, ids), isNull(tickets.deletedAt)))
        .orderBy(asc(tickets.id))
        .for("update")
    : Promise.resolve([]);

/**
 * Locks live tickets in ID order in one statement. With `withTracked`, the tickets that any tracker
 * among them tracks are locked in the same statement, so a request that also moves or replies on
 * them never waits for a ticket while holding a higher one (no deadlock with another such request).
 */
export async function lockTickets(
  db: Database,
  ids: TypeId<"ticket">[],
  withTracked = false,
) {
  const extra = withTracked ? await trackedIds(db, ids) : [];
  return lockIds(db, [...new Set([...ids, ...extra])]);
}

/** The live customer tickets a tracker tracks, locked in ID order. */
export async function lockedLinkedTickets(
  db: Database,
  trackerId: TypeId<"ticket">,
) {
  return lockIds(db, await trackedIds(db, [trackerId]));
}

/** An agent action stamps first_response_at once. */
const firstResponse = (ticket: TicketRow, now: Date) =>
  ticket.firstResponseAt ? {} : { firstResponseAt: now };

/**
 * Moves a ticket to a live status: stamps resolved_at when it enters a closed status, clears it and
 * counts a reopen when it leaves one, records the move, posts the requester-facing stage line, and
 * moves a tracker's open linked customer tickets with it.
 */
export async function changeStatus(
  db: Database,
  actor: QuillsActor,
  ticket: TicketRow,
  target: Status,
  cascade = true,
): Promise<TicketRow> {
  const now = new Date();
  // The current status may be soft-deleted; its category still decides the transition.
  const [current] = await db
    .select()
    .from(ticketStatuses)
    .where(eq(ticketStatuses.id, ticket.statusId))
    .limit(1);
  const from = current?.category ?? "open";
  const entering = target.category === "closed" && from !== "closed";
  const leaving = from === "closed" && target.category !== "closed";
  const [updated] = await db
    .update(tickets)
    .set({
      statusId: target.id,
      updatedAt: now,
      ...firstResponse(ticket, now),
      ...(entering && { resolvedAt: now }),
      ...(leaving && {
        resolvedAt: null,
        reopenedCount: sql`${tickets.reopenedCount} + 1`,
      }),
    })
    .where(eq(tickets.id, ticket.id))
    .returning();
  if (ticket.statusId === target.id) return updated!;
  await recordActivity(db, ticket.id, actor.principalId, "status.changed", {
    fromId: ticket.statusId,
    fromName: current?.name ?? null,
    toId: target.id,
    toName: target.name,
  });
  const stage = target.publicStage;
  if (stage && stage !== (current?.publicStage ?? null)) {
    const label = (await stageLabels(db))[stage];
    await systemMessage(db, ticket.id, `Status updated to ${label}`, {
      kind: "ticket_status_changed",
      stageLabel: label,
    });
  } else if (!stage && ticket.type === "customer" && entering)
    await systemMessage(db, ticket.id, "Ticket closed", {
      kind: "ticket_status_changed",
      closed: true,
    });
  if (cascade && ticket.type === "tracker" && from !== target.category) {
    // A tracker never reopens a closed linked ticket. Same transaction: all moves commit together.
    const linked = await lockedLinkedTickets(db, ticket.id);
    const open = new Set(
      (
        await db
          .select({ id: ticketStatuses.id })
          .from(ticketStatuses)
          .where(ne(ticketStatuses.category, "closed"))
      ).map((s) => s.id),
    );
    for (const row of linked)
      if (row.statusId !== target.id && open.has(row.statusId))
        await changeStatus(db, actor, row, target, false);
  }
  return updated!;
}

export async function changePriority(
  db: Database,
  actor: QuillsActor,
  ticket: TicketRow,
  priority: Priority,
): Promise<TicketRow> {
  const now = new Date();
  const [updated] = await db
    .update(tickets)
    .set({ priority, updatedAt: now, ...firstResponse(ticket, now) })
    .where(eq(tickets.id, ticket.id))
    .returning();
  if (ticket.priority !== priority)
    await recordActivity(db, ticket.id, actor.principalId, "priority.changed", {
      from: ticket.priority,
      to: priority,
    });
  return updated!;
}

/** An absent side stays as it is; null clears it. A new assignee also becomes a watcher. */
export async function changeAssignment(
  db: Database,
  actor: QuillsActor,
  ticket: TicketRow,
  members: readonly string[],
  next: {
    principalId?: TypeId<"principal"> | null;
    teamId?: TypeId<"team"> | null;
  },
): Promise<TicketRow> {
  if (next.principalId) await findTeammate(db, members, next.principalId);
  if (next.teamId) await findTeam(db, next.teamId);
  const now = new Date();
  const [updated] = await db
    .update(tickets)
    .set({
      updatedAt: now,
      ...firstResponse(ticket, now),
      ...(next.principalId !== undefined && {
        assigneePrincipalId: next.principalId,
      }),
      ...(next.teamId !== undefined && { assigneeTeamId: next.teamId }),
    })
    .where(eq(tickets.id, ticket.id))
    .returning();
  const row = updated!;
  const movedPrincipal = row.assigneePrincipalId !== ticket.assigneePrincipalId;
  const movedTeam = row.assigneeTeamId !== ticket.assigneeTeamId;
  if (!movedPrincipal && !movedTeam) return row;
  if (movedPrincipal && row.assigneePrincipalId)
    await subscribe(db, ticket.id, row.assigneePrincipalId, "assignee");
  const names = async <T extends string>(
    table: typeof principal | typeof teams,
    ids: (T | null)[],
  ) => {
    const wanted = ids.filter((id): id is T => id !== null);
    if (!wanted.length) return new Map<string, string | null>();
    const rows =
      table === teams
        ? await db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(inArray(teams.id, wanted as TypeId<"team">[]))
        : await db
            .select({ id: principal.id, name: principal.displayName })
            .from(principal)
            .where(inArray(principal.id, wanted as TypeId<"principal">[]));
    return new Map<string, string | null>(rows.map((r) => [r.id, r.name]));
  };
  const metadata: Record<string, string | null> = {};
  if (movedPrincipal) {
    const n = await names(principal, [
      ticket.assigneePrincipalId,
      row.assigneePrincipalId,
    ]);
    Object.assign(metadata, {
      fromPrincipalId: ticket.assigneePrincipalId,
      fromPrincipalName: n.get(ticket.assigneePrincipalId ?? "") ?? null,
      toPrincipalId: row.assigneePrincipalId,
      toPrincipalName: n.get(row.assigneePrincipalId ?? "") ?? null,
    });
  }
  if (movedTeam) {
    const n = await names(teams, [ticket.assigneeTeamId, row.assigneeTeamId]);
    Object.assign(metadata, {
      fromTeamId: ticket.assigneeTeamId,
      fromTeamName: n.get(ticket.assigneeTeamId ?? "") ?? null,
      toTeamId: row.assigneeTeamId,
      toTeamName: n.get(row.assigneeTeamId ?? "") ?? null,
    });
  }
  await recordActivity(
    db,
    ticket.id,
    actor.principalId,
    "ticket.assigned",
    metadata,
  );
  return row;
}
