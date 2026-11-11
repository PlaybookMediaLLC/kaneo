import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { runRead, type BatchedRead } from "../framework/read-batch";

// Several teammate reads in one request (readTogetherFn). It holds no authority of its own: each
// element runs through framework/read-batch.ts#runRead, the route's own schema, action check,
// handler and response schema, for the same caller in the same transaction.

const MAX_READS = 20;

const batch = defineQuillsRoute({
  method: "post",
  path: "/read-batch",
  operationId: "readQuillsTogether",
  summary: "Run up to 20 teammate reads in one request",
  description:
    "Each read names a teammate GET route by operationId, with its query values. A route with path parameters, native permissions, a project or a step outside its handler is not batchable (status 404), and neither is this route. Each result carries the status that the route itself answers this caller (200, 400, 403, 404 or 409) and, for 200, the route's JSON answer as text. One refused read does not fail the others; an unexpected server error fails the batch.",
  action: "read",
  callerActions: true,
  body: z.object({
    reads: z
      .array(
        z.object({
          operationId: z.string().min(1).max(100),
          query: z
            .record(z.string().max(100), z.string().max(2000))
            .refine((query) => Object.keys(query).length <= 30, {
              message: "At most 30 query values",
            })
            .optional(),
        }),
      )
      .min(1)
      .max(MAX_READS),
  }),
  response: z.object({
    results: z.array(
      z.object({
        operationId: z.string(),
        status: z.number(),
        body: z.string().nullable(),
      }),
    ),
  }),
  responseDescription: "One result for each read, in order",
  event: { none: "Read only: every element is a GET route" },
  handler: async ({ db, actor, actions, workspaceId, body }) => {
    const results: BatchedRead[] = [];
    // One at a time: the reads share the request's transaction.
    for (const read of body.reads)
      results.push(await runRead(db, { actor, actions, workspaceId }, read));
    return { results };
  },
});

/** Teammate route. */
export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...batch,
);
