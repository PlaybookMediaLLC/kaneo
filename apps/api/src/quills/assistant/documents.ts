import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { assistantDocuments } from "../../database/quills/schema/assistant";
import { defineQuillsRoute } from "../framework/define-route";

// Knowledge documents: text the assistant grounds answers on. This build takes the text itself
// (plain text or Markdown); it stores no original file, so storage_key stays null.

const MAX_DOCUMENTS = 200;
const params = z.object({
  documentId: flexibleToTypeIdSchema("assistant_document"),
});
const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  characters: z.number(),
  createdAt: responseTimestamp,
});
const columns = {
  id: assistantDocuments.id,
  title: assistantDocuments.title,
  fileName: assistantDocuments.fileName,
  mimeType: assistantDocuments.mimeType,
  characters: sql<number>`char_length(${assistantDocuments.content})::int`,
  createdAt: assistantDocuments.createdAt,
};

const listDocuments = defineQuillsRoute({
  method: "get",
  path: "/assistant/documents",
  operationId: "listQuillsAssistantDocuments",
  summary: "List the assistant knowledge documents",
  description: "Newest first, without their text.",
  action: "manage_settings",
  response: z.object({ items: z.array(documentSchema) }),
  responseDescription: "The documents",
  handler: async ({ db }) => ({
    items: await db
      .select(columns)
      .from(assistantDocuments)
      .where(isNull(assistantDocuments.deletedAt))
      .orderBy(desc(assistantDocuments.createdAt))
      .limit(MAX_DOCUMENTS),
  }),
});

const createDocument = defineQuillsRoute({
  method: "post",
  path: "/assistant/documents",
  operationId: "uploadQuillsAssistantDocument",
  summary: "Add a knowledge document",
  description:
    "Plain text or Markdown, up to 100,000 characters. The copilot reads it when its documents knowledge is on; so does the widget, for the customer agent's setting.",
  action: "manage_settings",
  body: z.object({
    title: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["text/plain", "text/markdown"]),
    // The framework caps text inputs at 100,000 characters (bounded-inputs), about 15,000 words.
    content: z.string().trim().min(1).max(100000),
  }),
  response: documentSchema,
  responseDescription: "The new document",
  errors: { 409: `A workspace has at most ${MAX_DOCUMENTS} documents` },
  event: (_input, document) => ({
    type: "assistant_document.created",
    entityType: "assistant_document",
    entityId: document.id,
  }),
  handler: async ({ db, actor, body }) => {
    if (
      (await db.$count(
        assistantDocuments,
        isNull(assistantDocuments.deletedAt),
      )) >= MAX_DOCUMENTS
    )
      throw new HTTPException(409, {
        message: `A workspace has at most ${MAX_DOCUMENTS} documents`,
      });
    const [row] = await db
      .insert(assistantDocuments)
      .values({
        title: body.title,
        fileName: body.fileName,
        mimeType: body.mimeType,
        content: body.content,
        createdById: actor.principalId,
      })
      .returning(columns);
    return row!;
  },
});

const deleteDocument = defineQuillsRoute({
  method: "delete",
  path: "/assistant/documents/{documentId}",
  operationId: "deleteQuillsAssistantDocument",
  summary: "Delete a knowledge document",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted document's ID",
  errors: { 404: "Document not found" },
  event: ({ params }) => ({
    type: "assistant_document.deleted",
    entityType: "assistant_document",
    entityId: params.documentId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(assistantDocuments)
      .set({ deletedAt: new Date(), embedding: null, updatedAt: new Date() })
      .where(
        and(
          eq(assistantDocuments.id, params.documentId),
          isNull(assistantDocuments.deletedAt),
        ),
      )
      .returning({ id: assistantDocuments.id });
    if (!row) throw new HTTPException(404, { message: "Document not found" });
    return { id: row.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listDocuments)
  .openapi(...createDocument)
  .openapi(...deleteDocument);
