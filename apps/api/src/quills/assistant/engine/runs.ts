import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { conversationMessages } from "../../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../../database/quills/schema/conversation-attributes";
import { tickets } from "../../../database/quills/schema/tickets";
import { ticketTypes } from "../../../database/quills/schema/ticket-types";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { settings } from "../../../database/quills/schema/auth";
import { readConfig } from "../settings";
import { chatJson, untrusted } from "../provider";
import { readRun, type Run, type RunOutput, type UsageEntry } from "../runs";
import { answerCopilot } from "./copilot";
import { formatSources, searchArticles, searchKnowledge } from "./retrieval";
import {
  completeRun,
  failedUsage,
  nothing,
  requesterActions,
  transcript,
  type Work,
} from "./shared";

// Runs other than the copilot: one provider call each, with the requester's access re-checked.

type Answer = { output: RunOutput; usage: UsageEntry[] };
const output = (partial: Partial<RunOutput>): RunOutput => ({
  text: null,
  citations: [],
  proposedActionIds: [],
  values: [],
  ...partial,
});
const value = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.null(),
]);

async function translateMessage(
  workspaceId: string,
  input: Record<string, unknown>,
) {
  const [message] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, String(input.messageId) as never),
          isNull(conversationMessages.deletedAt),
        ),
      ),
  );
  if (!message) return "The message was deleted";
  const { value: answer, usage } = await chatJson(
    z.object({ text: z.string().min(1).max(20000) }),
    [
      {
        role: "system",
        content: `Translate the message into ${String(input.language).slice(0, 60)}. Keep names, URLs and placeholders. Answer with one JSON object: {"text": string}.`,
      },
      {
        role: "user",
        content: untrusted("message", message.content.slice(0, 10000)),
      },
    ],
    4000,
  );
  return {
    output: output({ text: answer.text }),
    usage: [
      { step: "message_translation", callType: "chat_completion", usage },
    ],
  } satisfies Answer;
}

async function previewAttribute(
  workspaceId: string,
  input: Record<string, unknown>,
) {
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [attribute] = await db
      .select({
        key: conversationAttributeDefinitions.key,
        label: conversationAttributeDefinitions.label,
        description: conversationAttributeDefinitions.description,
        fieldType: conversationAttributeDefinitions.fieldType,
        options: conversationAttributeDefinitions.options,
      })
      .from(conversationAttributeDefinitions)
      .where(
        eq(
          conversationAttributeDefinitions.id,
          String(input.attributeId) as never,
        ),
      );
    return (
      attribute && {
        attribute,
        thread: await transcript(
          db,
          { conversationId: String(input.conversationId) },
          false,
        ),
      }
    );
  });
  if (!context) return "The attribute was deleted";
  const { attribute } = context;
  const options = (attribute.options ?? []).map((option) => option.label);
  const { value: answer, usage } = await chatJson(
    z.object({ value, reason: z.string().max(500) }),
    [
      {
        role: "system",
        content: [
          "Decide the value of one conversation attribute from the conversation below.",
          `Attribute: ${attribute.label} (${attribute.fieldType})${attribute.description ? `. ${attribute.description}` : ""}`,
          options.length ? `Allowed values: ${options.join(", ")}` : "",
          'Answer with one JSON object: {"value": string | number | boolean | null, "reason": string}. Use null when the conversation does not say.',
        ].join("\n"),
      },
      {
        role: "user",
        content: untrusted("thread", context.thread || "No messages."),
      },
    ],
  );
  const allowed =
    !options.length ||
    answer.value === null ||
    options.includes(String(answer.value));
  return {
    output: output({
      values: [
        {
          key: attribute.key,
          value: allowed ? answer.value : null,
          reason: answer.reason,
        },
      ],
    }),
    usage: [
      { step: "attribute_detection", callType: "chat_completion", usage },
    ],
  } satisfies Answer;
}

async function suggestTicketFields(
  workspaceId: string,
  input: Record<string, unknown>,
) {
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [ticket] = await db
      .select({ title: tickets.title, fields: ticketTypes.fields })
      .from(tickets)
      .leftJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
      .where(eq(tickets.id, String(input.ticketId) as never));
    return (
      ticket && {
        ticket,
        thread: await transcript(
          db,
          { ticketId: String(input.ticketId) },
          false,
        ),
      }
    );
  });
  if (!context?.ticket.fields?.length) return "The ticket's type has no fields";
  const fields = context.ticket.fields;
  const { value: answer, usage } = await chatJson(
    z.object({
      values: z
        .array(
          z.object({ key: z.string(), value, reason: z.string().max(500) }),
        )
        .max(50),
    }),
    [
      {
        role: "system",
        content: [
          "Suggest a value for each ticket field from the ticket below. Use null when the ticket does not say.",
          ...fields.map(
            (field) =>
              `- ${field.key} (${field.type}): ${field.label}${field.options?.length ? `; one of ${field.options.join(", ")}` : ""}`,
          ),
          'Answer with one JSON object: {"values": [{"key": string, "value": string | number | boolean | null, "reason": string}]}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: untrusted(
          "ticket",
          `Title: ${context.ticket.title}\n${context.thread || "No messages."}`,
        ),
      },
    ],
    1500,
  );
  return {
    output: output({
      values: fields.map((field) => {
        const found = answer.values.find((entry) => entry.key === field.key);
        const ok =
          found &&
          (found.value === null ||
            !field.options?.length ||
            field.options.includes(String(found.value)));
        return {
          key: field.key,
          value: ok ? found.value : null,
          reason: found?.reason ?? null,
        };
      }),
    }),
    usage: [{ step: "ticket_fields", callType: "chat_completion", usage }],
  } satisfies Answer;
}

async function askKnowledgeBase(
  workspaceId: string,
  input: Record<string, unknown>,
) {
  const question = String(input.question).slice(0, 1000);
  // The customer agent's knowledge settings decide the sources, at the public ceiling.
  const sources = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    const { knowledge } = readConfig(row!.config).agent;
    return [
      ...(knowledge.helpCenter
        ? await searchArticles(db, question, "public")
        : []),
      ...(await searchKnowledge(db, question, "public", knowledge.documents)),
    ];
  });
  if (!sources.length)
    return {
      output: output({
        text: "I could not find an answer in the help center. Contact the team for help.",
      }),
      usage: [],
    } satisfies Answer;
  const { value: answer, usage } = await chatJson(
    z.object({
      text: z.string().min(1).max(4000),
      sourceIds: z.array(z.string()).max(10),
    }),
    [
      {
        role: "system",
        content:
          'Answer the customer\'s question only from the sources below. When they do not answer it, say so and suggest contacting the team. Answer with one JSON object: {"text": string, "sourceIds": string[]} listing the IDs you used.',
      },
      { role: "system", content: untrusted("sources", formatSources(sources)) },
      { role: "user", content: untrusted("question", question) },
    ],
  );
  return {
    output: output({
      text: answer.text,
      citations: sources
        .filter((source) => answer.sourceIds.includes(source.id))
        .map(({ type, id, title }) => ({ type, id, title })),
    }),
    usage: [{ step: "kb_ask", callType: "chat_completion", usage }],
  } satisfies Answer;
}

const handlers = {
  translate_message: {
    needs: "read",
    run: translateMessage,
    step: "message_translation",
  },
  attribute_preview: {
    needs: "manage_settings",
    run: previewAttribute,
    step: "attribute_detection",
  },
  ticket_fields: {
    needs: "read",
    run: suggestTicketFields,
    step: "ticket_fields",
  },
  kb_ask: { needs: null, run: askKnowledgeBase, step: "kb_ask" },
} as const;

/** assistant_run.requested: answers the run and stores the outcome. A finished run is left as it is. */
export const answerRun: Work = async (workspaceId, event) => {
  const runId = event.entityId;
  const run: Run | undefined = await withQuillsSystemWorkspace(
    workspaceId,
    (db) => readRun(db, runId),
  );
  if (!run || run.status !== "pending") return nothing;
  if (run.kind === "copilot") return answerCopilot(workspaceId, runId, run);
  const handler = handlers[run.kind];
  const finish = (
    outcome: Parameters<typeof completeRun>[1],
    usage: UsageEntry[] = [],
  ) => completeRun(runId, outcome, usage);
  // A teammate's run needs that teammate's access now; a widget visitor's session was checked on request.
  if (
    handler.needs &&
    !(await requesterActions(workspaceId, run.principalId)).includes(
      handler.needs,
    )
  )
    return finish({
      status: "failed",
      error: "You no longer have access to this workspace",
    });
  try {
    const answer = await handler.run(workspaceId, run.input);
    return typeof answer === "string"
      ? finish({ status: "failed", error: answer })
      : finish({ status: "succeeded", output: answer.output }, answer.usage);
  } catch (error) {
    const usage = [failedUsage(handler.step, "chat_completion", error)];
    return finish({ status: "failed", error: (error as Error).message }, usage);
  }
};
