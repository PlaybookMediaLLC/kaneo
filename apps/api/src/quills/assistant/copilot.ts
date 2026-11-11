import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { assistantEvents } from "../../database/quills/schema/assistant-events";
import { settings } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { tickets } from "../../database/quills/schema/tickets";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { chatJson, requireAi, toHttp, untrusted } from "./provider";
import { createRun, logUsage, readRun, runSchema, runView } from "./runs";
import { readConfig } from "./settings";

// The copilot: a teammate asks about one conversation or ticket. The request stores a run;
// a worker answers it after commit (assistant_run.requested) with the asker's access, and
// write tools only propose actions. The teammate polls the run, or reloads on QUILLS_CHANGED.

const item = {
  conversationId: flexibleToTypeIdSchema("conversation").optional(),
  ticketId: flexibleToTypeIdSchema("ticket").optional(),
};
const oneItem = (value: { conversationId?: string; ticketId?: string }) =>
  Boolean(value.conversationId) !== Boolean(value.ticketId);
const itemMessage = { message: "Send a conversationId or a ticketId" };
const errors = {
  404: "Conversation, ticket or run not found",
  409: "AI is not configured, or copilot Q&A is turned off",
};

/** The conversation or ticket exists in this workspace: 404 otherwise. */
export async function requireItem(
  db: Database,
  ref: { conversationId?: string; ticketId?: string },
) {
  const found = ref.conversationId
    ? await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, ref.conversationId as never))
    : await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(eq(tickets.id, ref.ticketId as never), isNull(tickets.deletedAt)),
        );
  if (!found.length)
    throw new HTTPException(404, {
      message: ref.conversationId
        ? "Conversation not found"
        : "Ticket not found",
    });
}

const askCopilot = defineQuillsRoute({
  method: "post",
  path: "/assistant/copilot",
  operationId: "createQuillsAdminAssistantCopilot",
  summary: "Ask the copilot about a conversation or ticket",
  description:
    "Returns a pending run. A worker answers with the asking teammate's access; a write tool only proposes a pending action. Poll getQuillsAssistantRun. 409 when AI is not configured or copilot Q&A is off.",
  action: "read",
  body: z
    .object({
      ...item,
      question: z.string().trim().min(1).max(4000),
      history: z
        .array(
          z.object({
            role: z.enum(["teammate", "assistant"]),
            content: z.string().trim().min(1).max(4000),
          }),
        )
        .max(20)
        .default([]),
    })
    .refine(oneItem, itemMessage),
  load: async () => {
    requireAi();
  },
  response: runSchema,
  responseDescription: "The pending run",
  errors,
  event: (_input, run) => ({
    type: "assistant_run.requested",
    entityType: "assistant_run",
    entityId: run.id,
    payload: { kind: run.kind },
  }),
  handler: async ({ db, actor, body }) => {
    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    if (!readConfig(row!.config).copilot.qa)
      throw new HTTPException(409, { message: "Copilot Q&A is turned off" });
    await requireItem(db, body);
    const { id, run } = await createRun(db, actor.principalId, "copilot", {
      conversationId: body.conversationId ?? null,
      ticketId: body.ticketId ?? null,
      question: body.question,
      history: body.history,
    });
    return runView(id, run);
  },
});

const getRun = defineQuillsRoute({
  method: "get",
  path: "/assistant/runs/{runId}",
  operationId: "getQuillsAssistantRun",
  summary: "Get one of your assistant runs",
  description:
    "Only the teammate who started a run can read it. A run lasts a day.",
  action: "read",
  params: z.object({ runId: z.uuid() }),
  response: runSchema,
  responseDescription: "The run and, once finished, its answer",
  errors: { 404: "Run not found" },
  handler: async ({ db, actor, params }) => {
    const run = await readRun(db, params.runId);
    if (!run || run.principalId !== actor.principalId)
      throw new HTTPException(404, { message: "Run not found" });
    return runView(params.runId, run);
  },
});

const TRANSFORMS = {
  more_friendly: "Rewrite the text in a warmer, more friendly tone.",
  more_formal: "Rewrite the text in a more formal, professional tone.",
  more_concise:
    "Rewrite the text to be noticeably shorter without losing any facts.",
  expand:
    "Expand the text with helpful detail that stays consistent with what is already there.",
  rephrase: "Rephrase the text in different words with the same meaning.",
  fix_grammar:
    "Fix grammar, spelling and punctuation only. Do not change the meaning or tone.",
  translate: "",
} as const;
const textAnswer = z.object({ text: z.string().min(1).max(20000) });

const transform = defineQuillsRoute({
  method: "post",
  path: "/assistant/transform",
  operationId: "createQuillsAdminAssistantTransform",
  summary: "Rewrite a text with AI",
  description:
    "Tone, length, grammar or translation of text the teammate already has. The provider call runs before the transaction; the usage is logged with the answer. 409 when AI is not configured, 502 when the provider fails.",
  action: "read",
  body: z
    .object({
      kind: z.enum(
        Object.keys(TRANSFORMS) as [keyof typeof TRANSFORMS, ...string[]],
      ),
      text: z.string().trim().min(1).max(8000),
      language: z.string().trim().min(2).max(60).optional(),
    })
    .refine((body) => body.kind !== "translate" || body.language, {
      message: "A translation needs a target language",
    }),
  load: async ({ body }) => {
    requireAi();
    const task =
      body.kind === "translate"
        ? `Translate the text into ${body.language}. Keep names, URLs and placeholders as they are.`
        : TRANSFORMS[body.kind as keyof typeof TRANSFORMS];
    return chatJson(textAnswer, [
      {
        role: "system",
        content: [
          "You edit text for a support teammate.",
          `Task: ${task}`,
          "Keep every fact. Never add facts that are not in the text.",
          'Answer with one JSON object: {"text": string}.',
        ].join("\n"),
      },
      { role: "user", content: untrusted("text", body.text) },
    ]).catch((error) => {
      throw toHttp(error);
    });
  },
  response: z.object({ text: z.string() }),
  responseDescription: "The rewritten text",
  errors: { 409: "AI is not configured" },
  event: {
    none: "A rewrite changes no domain data; the usage log row is its record",
  },
  handler: async ({ db, body, loaded }) => {
    await logUsage(db, [
      {
        step: "copilot_transform",
        callType: "chat_completion",
        usage: loaded.usage,
        metadata: { transform: body.kind },
      },
    ]);
    return { text: loaded.value.text };
  },
});

const EVENT_TYPES = [
  "answer_inserted",
  "transform_inserted",
  "summary_inserted",
  "feedback",
] as const;

const recordEvent = defineQuillsRoute({
  method: "post",
  path: "/assistant/copilot-events",
  operationId: "recordQuillsCopilotEvent",
  summary: "Record how a teammate used a copilot answer",
  description:
    "Telemetry for the copilot report: an inserted answer (with where it landed) or thumbs feedback (with a rating).",
  action: "read",
  body: z
    .object({
      ...item,
      eventType: z.enum(EVENT_TYPES),
      destination: z.enum(["reply", "note"]).optional(),
      rating: z.enum(["up", "down"]).optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .refine(oneItem, itemMessage)
    .refine(
      (body) =>
        body.eventType === "feedback"
          ? Boolean(body.rating) && !body.destination
          : Boolean(body.destination) && !body.rating,
      {
        message:
          "A feedback event needs a rating; an inserted event needs a destination",
      },
    ),
  response: z.object({ id: z.string() }),
  responseDescription: "The recorded event's ID",
  errors: { 404: "Conversation or ticket not found" },
  event: {
    none: "Append-only telemetry in assistant_events, read only by the copilot report",
  },
  handler: async ({ db, actor, body }) => {
    await requireItem(db, body);
    const [row] = await db
      .insert(assistantEvents)
      .values({
        eventType: body.eventType,
        principalId: actor.principalId,
        conversationId: (body.conversationId ?? null) as never,
        ticketId: (body.ticketId ?? null) as never,
        metadata: {
          ...(body.destination && { destination: body.destination }),
          ...(body.rating && { rating: body.rating }),
          ...(body.reason && { reason: body.reason }),
        },
      })
      .returning({ id: assistantEvents.id });
    return { id: row!.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...askCopilot)
  .openapi(...getRun)
  .openapi(...transform)
  .openapi(...recordEvent);
