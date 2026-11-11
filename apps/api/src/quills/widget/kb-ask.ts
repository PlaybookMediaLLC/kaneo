import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { requireAi } from "../assistant/provider";
import { createRun, readRun, runSchema, runView } from "../assistant/runs";

// Ask the help center from the widget. The request stores a run for the visitor; a worker answers
// it after commit from published articles that no segment gates and from public snippets only.

const ask = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/widget/kb-ask",
  operationId: "createQuillsWidgetKbAsk",
  summary: "Ask the help center a question from the widget",
  description:
    "Returns a pending run; poll getQuillsWidgetKbAsk. The answer cites only public help-center content. 409 when AI is not configured.",
  action: "create",
  rateLimit: { limit: 10, windowSeconds: 600 },
  body: z.object({ question: z.string().trim().min(3).max(1000) }),
  response: runSchema,
  responseDescription: "The pending run",
  errors: { 409: "AI is not configured" },
  event: (_input, run) => ({
    type: "assistant_run.requested",
    entityType: "assistant_run",
    entityId: run.id,
    payload: { kind: run.kind },
  }),
  handler: async ({ db, caller, body }) => {
    requireAi();
    const { id, run } = await createRun(db, caller.principalId!, "kb_ask", {
      question: body.question,
    });
    return runView(id, run);
  },
});

const answer = defineQuillsRoute({
  audience: "widget",
  method: "get",
  path: "/widget/kb-ask/{runId}",
  operationId: "getQuillsWidgetKbAsk",
  summary: "Get the answer to a widget question",
  description: "Only the visitor who asked can read it. A run lasts a day.",
  action: "read",
  params: z.object({ runId: z.uuid() }),
  response: runSchema,
  responseDescription: "The run and, once finished, its answer",
  errors: { 404: "Run not found" },
  handler: async ({ db, caller, params }) => {
    const run = await readRun(db, params.runId);
    if (!run || run.kind !== "kb_ask" || run.principalId !== caller.principalId)
      throw new HTTPException(404, { message: "Run not found" });
    return runView(params.runId, run);
  },
});

export default apiRouter()
  .openapi(...ask)
  .openapi(...answer);
