import { and, desc, eq, isNull } from "drizzle-orm";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { conversationMessages } from "../../../database/quills/schema/conversation";
import type { DeliveryEvent } from "../../jobs/fanout";
import { memberQuillsActions } from "../../framework/platform-reads";
import { AiError } from "../provider";
import { recordQuillsChange } from "../../events";
import { finishRun, logUsage, type UsageEntry } from "../runs";

// Worker side of the assistant: it reads in one system-scoped transaction, calls the provider with
// no transaction open, and returns a Write that the job handler runs with the job's completion.

export type Write = (db: Database) => Promise<void>;
export type Work = (
  workspaceId: string,
  event: DeliveryEvent,
) => Promise<Write>;
export const nothing: Write = async () => {};

/** Stores a run's outcome with its usage rows, and records assistant_run.completed. */
export const completeRun =
  (
    runId: string,
    outcome: Parameters<typeof finishRun>[2],
    usage: UsageEntry[] = [],
  ): Write =>
  async (db) => {
    await logUsage(db, usage);
    await finishRun(db, runId, outcome);
    await recordQuillsChange(db, null, {
      type: "assistant_run.completed",
      entityType: "assistant_run",
      entityId: runId,
    });
  };

/** The fixed code of an AI failure, for the usage log. Anything else is rethrown. */
export function failureCode(error: unknown) {
  if (error instanceof AiError) return error.code;
  throw error;
}

/** A usage entry that records a failed provider call. */
export const failedUsage = (
  step: string,
  callType: UsageEntry["callType"],
  error: unknown,
): UsageEntry => ({ step, callType, error: failureCode(error) });

/**
 * The Quills actions that a teammate principal holds now. A worker acts for a requester only
 * while that person is still a member with the needed permission.
 */
export async function requesterActions(
  workspaceId: string,
  principalId: string,
): Promise<string[]> {
  const [row] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({ userId: principal.kaneoUserId })
      .from(principal)
      .where(eq(principal.id, principalId as never)),
  );
  return row?.userId ? memberQuillsActions(workspaceId, row.userId) : [];
}

/** A conversation's or ticket's recent messages, oldest first. `internal` adds team notes. */
export async function transcript(
  db: Database,
  ref: { conversationId?: string | null; ticketId?: string | null },
  internal: boolean,
  limit = 40,
) {
  const rows = await db
    .select({
      senderType: conversationMessages.senderType,
      content: conversationMessages.content,
      isInternal: conversationMessages.isInternal,
    })
    .from(conversationMessages)
    .where(
      and(
        ref.conversationId
          ? eq(conversationMessages.conversationId, ref.conversationId as never)
          : eq(conversationMessages.ticketId, ref.ticketId as never),
        isNull(conversationMessages.deletedAt),
        internal ? undefined : eq(conversationMessages.isInternal, false),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .map(
      (row) =>
        `${row.isInternal ? "team note" : row.senderType}: ${row.content.slice(0, 2000)}`,
    )
    .join("\n");
}
