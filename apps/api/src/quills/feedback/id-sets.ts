// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

/** 404 unless the workspace-scoped lookup found every requested ID. */
export function requireAll(
  ids: readonly string[],
  found: readonly { id: string }[],
  what: string,
) {
  const present = new Set(found.map((row) => String(row.id)));
  if (ids.some((id) => !present.has(id)))
    throw new HTTPException(404, { message: `${what} not found` });
}

/** A reorder names every live row exactly once: unknown IDs are 404, a stale or partial list is 409. */
export function checkOrder(ids: readonly string[], live: readonly string[]) {
  requireAll(
    ids,
    live.map((id) => ({ id })),
    "Item",
  );
  if (ids.length !== new Set(live).size)
    throw new HTTPException(409, {
      message: "Send every item exactly once in the new order",
    });
}

/** The position of each ID is its index in the list. */
export const positionCase = (id: AnyColumn, ids: readonly string[]): SQL =>
  sql`case ${sql.join(
    ids.map((value, index) => sql`when ${eq(id, value)} then ${index}::int`),
    sql` `,
  )} end`;
