import { and, asc, eq, isNull } from "drizzle-orm";
import {
  type EmailAttachment,
  MAX_EMAIL_ATTACHMENT_BYTES,
} from "@kaneo/email/quills";
import type { Database } from "../../../database/quills/client";
import { conversationMessages } from "../../../database/quills/schema/conversation";
import { files } from "../../../database/quills/schema/files";
import { isMissingObjectError } from "../../../storage/head-uploaded-object";
import { isImageContentType } from "../../../storage/s3";
import { readObject } from "../../framework/files";
import { mintPublicMediaToken } from "../../framework/request-magic-link";
import type { OutboundInlineImage } from "../../inbound/html-media";
import { portalPaths } from "../../portal/paths";

type MessageId = (typeof conversationMessages.$inferSelect)["id"];

/** Inline images at or below 512 KB ship as MIME CID attachments; larger ones use signed public media redirects (#326). */
export const INLINE_CID_MAX_BYTES = 512 * 1024;

/** The live files of a message, in upload order. Read in the mail job's transaction. */
export const messageFiles = (db: Database, messageId: MessageId) =>
  db
    .select({
      id: files.id,
      storageKey: files.storageKey,
      name: files.name,
      contentType: files.contentType,
      family: files.family,
      size: files.size,
    })
    .from(files)
    .where(and(eq(files.messageId, messageId), isNull(files.deletedAt)))
    .orderBy(asc(files.createdAt), asc(files.id));

type StoredFile = Awaited<ReturnType<typeof messageFiles>>[number];

export interface LoadedMailMedia {
  attachments: EmailAttachment[];
  inlineImages: OutboundInlineImage[];
}

/**
 * Loads attachments and resolves inline images (`#326`) outside any DB transaction:
 * - Raster images `<= 512 KB` (that fit within the remaining budget) are attached with
 *   `disposition: "inline"` and `contentId: "<fileId>@quills"`.
 * - Larger raster images use a long-lived signed `/api/quills-public/{ws}/media/{token}` URL.
 * - Non-raster files (including SVGs) are attached as regular MIME attachments.
 */
export async function loadMailMedia(
  workspaceId: string,
  stored: readonly StoredFile[],
  budget = MAX_EMAIL_ATTACHMENT_BYTES,
  read = readObject,
): Promise<LoadedMailMedia> {
  const attachments: EmailAttachment[] = [];
  const inlineImages: OutboundInlineImage[] = [];
  let left = budget;
  for (const file of stored) {
    const isImage = isImageContentType(file.contentType);
    if (isImage && file.size > INLINE_CID_MAX_BYTES) {
      const token = mintPublicMediaToken({ workspaceId, fileId: file.id });
      inlineImages.push({
        fileId: file.id,
        filename: file.name,
        src: portalPaths.publicMedia(workspaceId, token),
      });
      continue;
    }
    if (file.size > left) {
      if (isImage) {
        const token = mintPublicMediaToken({ workspaceId, fileId: file.id });
        inlineImages.push({
          fileId: file.id,
          filename: file.name,
          src: portalPaths.publicMedia(workspaceId, token),
        });
      }
      continue;
    }
    try {
      const content = await read(file.storageKey, left);
      left -= content.length;
      if (isImage) {
        const contentId = `${file.id}@quills`;
        attachments.push({
          filename: file.name,
          contentType: file.contentType,
          content: new Uint8Array(content),
          contentId,
          disposition: "inline",
        });
        inlineImages.push({
          fileId: file.id,
          filename: file.name,
          src: `cid:${contentId}`,
        });
      } else {
        attachments.push({
          filename: file.name,
          contentType: file.contentType,
          content: new Uint8Array(content),
          disposition: "attachment",
        });
      }
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
  }
  return { attachments, inlineImages };
}

/** Backwards-compatible wrapper returning only MIME attachments. */
export async function loadMailAttachments(
  stored: readonly StoredFile[],
  budget = MAX_EMAIL_ATTACHMENT_BYTES,
  read = readObject,
): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];
  let left = budget;
  for (const file of stored) {
    if (file.size > left) continue;
    try {
      const content = await read(file.storageKey, left);
      left -= content.length;
      attachments.push({
        filename: file.name,
        contentType: file.contentType,
        content: new Uint8Array(content),
      });
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
  }
  return attachments;
}
