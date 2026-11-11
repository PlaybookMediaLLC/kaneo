// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PrincipalId } from "@kaneo/ids";
import { kvStore } from "../../../database/quills/schema/kv";
import type { Database } from "../../framework/define-route";
import { record } from "../../settings/area";

const RECEIPT_MS = 24 * 60 * 60 * 1000;

/**
 * An idempotency receipt for one create, per caller and key (RFC 0002 of packages/widget):
 * returns the ID that an earlier request with the same key and payload created, null for a new
 * key, and 409 for the same key with another payload. A concurrent request with the same key
 * waits on the receipt row until the first commits. Retention deletes expired receipts.
 */
export async function claimReceipt(
  db: Database,
  kind: "post" | "comment",
  principalId: PrincipalId,
  key: string,
  payload: Record<string, string | null>,
) {
  const name = `receipt:${kind}:${principalId}:${key}`;
  const where = and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, name));
  const expiresAt = new Date(Date.now() + RECEIPT_MS);
  const [claimed] = await db
    .insert(kvStore)
    .values({ workspaceKey: "_", key: name, value: { payload }, expiresAt })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: { value: { payload }, expiresAt },
      // An expired receipt that retention has not deleted yet is free again.
      setWhere: sql`${kvStore.expiresAt} <= now()`,
    })
    .returning({ key: kvStore.key });
  const finish = async (id: string) => {
    await db.update(kvStore).set({ value: { payload, id } }).where(where);
  };
  if (claimed) return { replayOf: null, finish };
  const [row] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(where);
  const stored = record(row?.value);
  const before = record(stored.payload);
  if (
    typeof stored.id !== "string" ||
    Object.keys(payload).some((field) => before[field] !== payload[field])
  )
    throw new HTTPException(409, {
      message: "This idempotency key was used for a different request",
    });
  return { replayOf: stored.id, finish };
}
