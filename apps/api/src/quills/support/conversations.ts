import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../framework/define-route";
import { listConversations, listFilters } from "./conversation-list";
import {
  conversationDetail,
  conversationItem,
  conversationParams,
  errors,
  findConversation,
  loadConversation,
} from "./conversation-model";

const listRoute = defineQuillsRoute({
  method: "get",
  path: "/conversations",
  operationId: "listQuillsConversations",
  summary: "List support conversations",
  description:
    "Leaves out test conversations. Spam-ended conversations appear only with view=spam. `assignee` is mine, unassigned or a teammate principal ID; view=mentions and view=created_by_me always mean the caller.",
  action: "read",
  query: listFilters,
  response: z.object({
    items: z.array(conversationItem),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of conversations",
  errors,
  handler: ({ db, actor, query }) => listConversations(db, actor, query),
});

const getRoute = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}",
  operationId: "getQuillsConversation",
  summary: "Get a support conversation",
  description:
    "Includes tags, attribute values, the stored summary and the translation state.",
  action: "read",
  params: conversationParams,
  response: conversationDetail,
  responseDescription: "Conversation",
  errors,
  handler: ({ db, params }) => loadConversation(db, params.conversationId),
});

const TRANSCRIPT_MAX = 5000;
const transcriptRoute = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/transcript",
  operationId: "exportQuillsConversationTranscript",
  summary: "Export a conversation transcript",
  description: `Markdown, oldest first, with internal notes marked. At most ${TRANSCRIPT_MAX} messages; \`truncated\` is true when more exist.`,
  action: "read",
  params: conversationParams,
  response: z.object({
    filename: z.string(),
    mimeType: z.literal("text/markdown"),
    content: z.string(),
    truncated: z.boolean(),
  }),
  responseDescription: "Transcript",
  errors,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    const rows = await db
      .select({
        senderType: conversationMessages.senderType,
        isInternal: conversationMessages.isInternal,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
        author: principal.displayName,
      })
      .from(conversationMessages)
      .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .orderBy(
        asc(conversationMessages.createdAt),
        asc(conversationMessages.id),
      )
      .limit(TRANSCRIPT_MAX + 1);
    const utc = (date: Date) =>
      `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const speaker = (row: (typeof rows)[number]) =>
      row.senderType === "system"
        ? "System"
        : `${row.author ?? (row.senderType === "visitor" ? "Visitor" : "Agent")} (${row.senderType === "visitor" ? "visitor" : "agent"})${row.isInternal ? " · internal note" : ""}`;
    const lines = [
      `# Conversation ${conversation.id}`,
      "",
      ...(conversation.subject ? [`- Subject: ${conversation.subject}`] : []),
      `- Status: ${conversation.status}`,
      `- Channel: ${conversation.channel}`,
      `- Created: ${utc(conversation.createdAt)}`,
      "",
      ...rows
        .slice(0, TRANSCRIPT_MAX)
        .flatMap((row) => [
          `**${speaker(row)}** · ${utc(row.createdAt)}`,
          "",
          row.content,
          "",
        ]),
    ];
    return {
      filename: `conversation-${conversation.id}.md`,
      mimeType: "text/markdown" as const,
      content: lines.join("\n"),
      truncated: rows.length > TRANSCRIPT_MAX,
    };
  },
});

const FILES_MAX = 200;
const filesRoute = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/files",
  operationId: "listQuillsConversationFiles",
  summary: "List the files attached in a conversation",
  description: `Every attachment of the live messages, internal notes included, newest first. At most ${FILES_MAX}.`,
  action: "read",
  params: conversationParams,
  response: z.object({
    items: z.array(
      z.object({
        messageId: z.string(),
        fileId: z.string().nullable(),
        name: z.string(),
        contentType: z.string(),
        size: z.number(),
        isInternal: z.boolean(),
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Files",
  errors,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    const rows = await db
      .select({
        messageId: conversationMessages.id,
        attachments: conversationMessages.attachments,
        isInternal: conversationMessages.isInternal,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversation.id),
          isNull(conversationMessages.deletedAt),
          isNotNull(conversationMessages.attachments),
          sql`jsonb_array_length(${conversationMessages.attachments}) > 0`,
        ),
      )
      .orderBy(
        desc(conversationMessages.createdAt),
        desc(conversationMessages.id),
      )
      .limit(FILES_MAX);
    const items = rows.flatMap((row) =>
      (row.attachments ?? []).map((file) => ({
        messageId: row.messageId,
        fileId: file.fileId ?? null,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        isInternal: row.isInternal,
        createdAt: row.createdAt,
      })),
    );
    return { items: items.slice(0, FILES_MAX) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listRoute)
  .openapi(...getRoute)
  .openapi(...transcriptRoute)
  .openapi(...filesRoute);
