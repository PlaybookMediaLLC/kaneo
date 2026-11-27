// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import type { Database } from "../framework/define-route";
import { digest } from "../framework/signed";

/**
 * Deterministic SHA-256 hash of a normalized email address for compliance receipts.
 * Never stores plaintext PII while allowing operators to verify a subject was erased.
 */
export function hashSubjectEmail(
  email: string | null | undefined,
): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  return digest(normalized);
}

/**
 * Returns the workspace's single deterministic tombstone principal ("Deleted user") used to
 * re-attribute structural records (threads, posts, comments, votes) without violating
 * ON DELETE RESTRICT foreign keys or retaining any customer PII.
 */
export async function getOrCreateDeletedPrincipal(
  db: Database,
): Promise<PrincipalId> {
  // Serialize tombstone creation per workspace inside the active transaction.
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('quills-privacy-tombstone'), hashtext(coalesce(current_setting('quills.workspace_id', true), '')))`,
  );

  const [existing] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        isNull(principal.userId),
        isNull(principal.kaneoUserId),
        eq(principal.type, "anonymous"),
        sql`coalesce(${principal.serviceMetadata}->>'tombstone', 'false') = 'true'`,
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(principal)
    .values({
      type: "anonymous",
      role: "user",
      displayName: "Deleted user",
      avatarUrl: null,
      avatarKey: null,
      contactEmail: null,
      userId: null,
      kaneoUserId: null,
      serviceMetadata: {
        tombstone: true,
      } as unknown as typeof principal.$inferInsert.serviceMetadata,
      createdAt: new Date(),
    })
    .returning({ id: principal.id });

  if (!created) throw new Error("Failed to create privacy tombstone principal");
  return created.id;
}
