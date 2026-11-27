// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { sql } from "drizzle-orm";
import { posts } from "../../../database/quills/schema/posts";

let iterativeScanSupported = false;

/** Records whether the connected PostgreSQL server's pgvector supports hnsw.iterative_scan (0.8+). */
export function setHnswIterativeScanSupported(supported: boolean): void {
  iterativeScanSupported = supported;
}

export function supportsHnswIterativeScan(): boolean {
  return iterativeScanSupported;
}

/**
 * Cosine distance for workspace-scoped RLS queries. When pgvector 0.8+ iterative HNSW scans are
 * available, client.ts sets hnsw.iterative_scan = 'strict_order' transaction-locally so the HNSW
 * indexes can be used without truncating after 40 global candidates. On pgvector 0.5-0.7, `0 +`
 * forces exact distance evaluation so RLS never drops rows.
 */
export const exactDistance = (column: unknown, target: unknown) =>
  iterativeScanSupported
    ? sql`(${column} <=> ${target})`
    : sql`(0 + (${column} <=> ${target}))`;

/** A fresh vector as a query parameter. */
export const vectorParam = (values: number[]) =>
  sql`${JSON.stringify(values)}::vector`;

/**
 * A post's stored vector, kept in SQL. The vector column type has no driver mapping, so a selected
 * vector would reach JavaScript as text; a subquery keeps it in the database.
 */
export const storedPostVector = (postId: string) =>
  sql`(SELECT embedding FROM quills.posts WHERE id = ${sql.param(postId, posts.id)})`;
