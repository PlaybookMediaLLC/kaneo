import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { apiRouter, z } from "../../openapi";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import { defineQuillsRoute } from "../framework/define-route";
import { imageRedirect, isImageContentType } from "../framework/files";
import { verifyInstancePublicMediaToken } from "../framework/request-magic-link";

const notFound = () => new HTTPException(404, { message: "Media not found" });

/**
 * Signed public inline image redirect for outbound customer emails (#326).
 * Strictly enforces raster-only image content types and a live, non-internal,
 * actually-sent message so SVGs, internal note images, and deleted/recalled uploads
 * can never be served inline through this route.
 */
const publicMedia = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/media/{token}",
  operationId: "getQuillsPublicMedia",
  summary: "Open a signed inline image from a support email",
  description:
    "Redirects to a short-lived signed object-storage URL for a raster inline image attached to a customer-visible, sent message. Returns 404 for expired, tampered, non-raster, deleted, recalled, or internal-note images.",
  action: "read",
  params: z.object({ token: z.string().min(20).max(512) }),
  response: z.object({ key: z.string(), contentType: z.string() }),
  responseDescription: "Redirect to the image object",
  errors: { 404: "Media not found" },
  handler: async ({ db, workspaceId, params }) => {
    const claims = verifyInstancePublicMediaToken(params.token, workspaceId);
    if (!claims) throw notFound();
    const [row] = await db
      .select({
        key: files.storageKey,
        contentType: files.contentType,
      })
      .from(files)
      .innerJoin(
        conversationMessages,
        eq(conversationMessages.id, files.messageId),
      )
      .where(
        and(
          eq(files.id, claims.fileId as TypeId<"file">),
          isNull(files.deletedAt),
          isNull(conversationMessages.deletedAt),
          isNull(conversationMessages.workspaceThreadKey),
          eq(conversationMessages.isInternal, false),
          eq(conversationMessages.sendStatus, "sent"),
        ),
      )
      .limit(1);
    if (!row?.key || !isImageContentType(row.contentType)) throw notFound();
    return { key: row.key, contentType: row.contentType };
  },
  location: async ({ key, contentType }) => {
    const target = await imageRedirect(key, contentType);
    if (!target) throw notFound();
    return target;
  },
});

export default apiRouter().openapi(...publicMedia);
