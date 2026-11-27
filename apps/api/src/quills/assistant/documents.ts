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
import { files } from "../../database/quills/schema/files";
import { defineQuillsRoute } from "../framework/define-route";
import { readObject, uploadedObject, verifyUpload } from "../framework/files";
import { registerFile } from "../files/files";
import { MAX_PDF_BYTES, PdfError, pdfText } from "./pdf-text";

// Knowledge documents: text the assistant grounds answers on. This build takes the text itself
// (plain text or Markdown), or the text layer of an uploaded PDF. It stores no original file, so
// storage_key stays null.

const MAX_DOCUMENTS = 200;
const MAX_TEXT = 100_000;
const tooMany = () =>
  new HTTPException(409, {
    message: `A workspace has at most ${MAX_DOCUMENTS} documents`,
  });
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
    content: z.string().trim().min(1).max(MAX_TEXT),
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
      throw tooMany();
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

const uploadPdf = defineQuillsRoute({
  method: "post",
  path: "/assistant/documents/pdf",
  operationId: "uploadQuillsAssistantPdfDocument",
  summary: "Add a knowledge document from a PDF",
  description: `Upload the PDF with POST /files/uploads (purpose \`file\`, at most ${MAX_PDF_BYTES / 1024 / 1024} MB) and send the uploaded object here. The PDF's text layer (at most ${MAX_TEXT.toLocaleString("en-US")} characters) becomes the document; the PDF itself is not kept. A scanned PDF without a text layer is refused.`,
  action: "manage_settings",
  // The uploaded object's key, type and size, as POST /files takes them.
  body: uploadedObject.extend({
    title: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
  }),
  // Reading and parsing the PDF happens before the transaction opens.
  // ponytail: the parse must end inside the upload lease (about 50 s), or the handler answers 503
  // and the client retries; stream the parse in a worker if large PDFs hit that limit.
  load: async ({ body, workspaceId }) => {
    if (body.contentType !== "application/pdf")
      throw new HTTPException(400, { message: "The upload is not a PDF" });
    if (body.size > MAX_PDF_BYTES)
      throw new HTTPException(400, { message: "The PDF is too large" });
    const upload = await verifyUpload(workspaceId, ["file"], {
      key: body.key,
      contentType: body.contentType,
      size: body.size,
    });
    // One read: the digest of the file row comes from the same bytes the parse reads.
    const bytes = await readObject(upload.key, MAX_PDF_BYTES);
    const sha256 = Buffer.from(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ).toString("hex");
    let text: string;
    try {
      text = await pdfText(bytes);
    } catch (error) {
      if (error instanceof PdfError)
        throw new HTTPException(400, { message: error.message });
      throw error;
    }
    if (!text)
      throw new HTTPException(400, {
        message: "This PDF has no text to read. A scanned PDF needs OCR first.",
      });
    return { upload: { ...upload, sha256 }, text: text.slice(0, MAX_TEXT) };
  },
  response: documentSchema,
  responseDescription: "The new document",
  errors: {
    400: "Not a readable PDF, or it has no text",
    404: "Upload not found",
    409: `A workspace has at most ${MAX_DOCUMENTS} documents, or the upload is already in use`,
  },
  event: (_input, document) => ({
    type: "assistant_document.created",
    entityType: "assistant_document",
    entityId: document.id,
  }),
  handler: async ({ db, actor, body, loaded }) => {
    if (
      (await db.$count(
        assistantDocuments,
        isNull(assistantDocuments.deletedAt),
      )) >= MAX_DOCUMENTS
    )
      throw tooMany();
    // The PDF is not kept: its file row is registered and removed at once, so the storage trigger
    // queues the object for deletion.
    const file = await registerFile(db, loaded.upload, {
      name: body.fileName,
      declaredType: body.contentType,
      source: "agent",
      uploadedById: actor.principalId,
    });
    // A key that a file row already uses belongs to something else (an attachment): never delete it.
    if (!file.created)
      throw new HTTPException(409, {
        message: "This upload is already in use. Upload the PDF again.",
      });
    await db.delete(files).where(eq(files.id, file.id as never));
    const [row] = await db
      .insert(assistantDocuments)
      .values({
        title: body.title,
        fileName: body.fileName,
        mimeType: "application/pdf",
        content: loaded.text,
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
  .openapi(...uploadPdf)
  .openapi(...deleteDocument);
