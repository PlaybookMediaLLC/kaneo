// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { sql } from "drizzle-orm";

/**
 * Cosine distance as an expression the HNSW index cannot serve. The index filters after its scan
 * (40 candidates across every workspace), so a workspace-scoped search reads exact distances.
 * ponytail: an exact scan of the workspace's embedded rows; turn on pgvector iterative scans in
 * the scoping layer if a workspace grows past tens of thousands of embedded rows.
 */
export const exactDistance = (column: unknown, target: unknown) =>
  sql`((${column} <=> ${target}) + 0)`;
