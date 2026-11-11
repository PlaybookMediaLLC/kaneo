import { HTTPException } from "hono/http-exception";
import type { Database, QuillsActor } from "../../database/quills/client";
import type { QuillsAction } from "../with-quills-request";
import type { AnyQuillsRoute } from "./define-route";
import { registry } from "./registry";

// Trusted for Quills route modules: runs one registered teammate read inside the scoped
// transaction of a batch request (support/read-batch.ts). It adds no check of its own and skips
// none: a read is batchable only when every check of its route runs in withQuillsRequest or in
// its handler. A route with path parameters, native permissions, a project resolver, `load`,
// `after` or `prepare` has checks outside the handler, so it is never batchable. Nor is a route
// with `alsoRequires` or `callerActions`: its single route checks the actions together in one
// role, where the batch has only each action alone.

/** A teammate GET route whose checks all run in withQuillsRequest and in its handler. */
export const batchable = (d: AnyQuillsRoute) =>
  (d.audience ?? "teammate") === "teammate" &&
  d.method === "get" &&
  Object.keys(d.params?.shape ?? {}).length === 0 &&
  !d.native &&
  !d.project &&
  !d.load &&
  !d.after &&
  !d.prepare &&
  !d.alsoRequires?.length &&
  !d.callerActions;

export type BatchedRead = {
  operationId: string;
  /** The status that the route itself answers this caller: 200, 400, 403, 404 or 409. */
  status: number;
  /** The route's own JSON answer, as text. Null for every status but 200. */
  body: string | null;
};

/**
 * One read, as its own route runs it for the same caller: the route's query schema first (400),
 * then its action against the caller's actions (role within the API-key scope, 403), then its
 * handler with the same transaction and actor, and its response schema. The read
 * runs in a savepoint, so a failed statement does not stop the next read. An expected failure
 * (HTTPException) stays in its result; any other error fails the batch.
 */
export async function runRead(
  db: Database,
  caller: {
    actor: QuillsActor;
    actions: ReadonlySet<QuillsAction>;
    workspaceId: string;
  },
  read: { operationId: string; query?: Record<string, string> },
): Promise<BatchedRead> {
  const { operationId } = read;
  const refused = (status: number) => ({ operationId, status, body: null });
  const d = [...registry.keys()].find(
    (route) => route.operationId === operationId && batchable(route),
  );
  if (!d) return refused(404);
  // Async, as the route's validator parses it.
  const query = await d.query?.safeParseAsync(read.query ?? {});
  if (query && !query.success) return refused(400);
  if (!caller.actions.has(d.action)) return refused(403);
  try {
    const result = await db.transaction(async (savepoint) =>
      d.response.parse(
        await d.handler({
          params: { workspaceId: caller.workspaceId },
          query: query?.data,
          body: undefined,
          workspaceId: caller.workspaceId,
          db: savepoint as Database,
          actor: caller.actor,
          loaded: undefined,
          // As on the route: a route without callerActions gives its handler no actions.
          actions: new Set(),
          called: undefined,
        }),
      ),
    );
    return { operationId, status: 200, body: JSON.stringify(result) };
  } catch (error) {
    if (error instanceof HTTPException) return refused(error.status);
    throw error;
  }
}
