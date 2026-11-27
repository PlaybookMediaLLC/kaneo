import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, settings, user } from "../../database/quills/schema/auth";
import { privacyRequests } from "../../database/quills/schema/privacy";
import { defineQuillsRoute } from "../framework/define-route";
import { createDownload, isQuillsStorageConfigured } from "../framework/files";
import { privacyRequestItemSchema } from "./erase-customer";
import { hashSubjectEmail } from "./tombstone";

const requestParams = z.object({
  requestId: flexibleToTypeIdSchema("privacy_request"),
});

function toRequestItem(row: typeof privacyRequests.$inferSelect) {
  const { exportS3Key: _, subjectEmailHash, ...rest } = row;
  return { ...rest, subjectDigest: subjectEmailHash };
}

const requestAccess = defineQuillsRoute({
  method: "post",
  path: "/privacy/access-requests",
  operationId: "createQuillsPrivacyAccessRequest",
  summary: "Start a single-customer data access/portability export",
  description:
    "Queues a background ZIP export containing the customer's profile, posts, comments, votes, conversations, non-internal messages, attachments, tickets, survey responses, and subscriptions.",
  action: "manage_settings",
  body: z.object({
    principalId: flexibleToTypeIdSchema("principal"),
  }),
  response: z.object({
    request: privacyRequestItemSchema,
  }),
  responseDescription: "The queued access request",
  errors: {
    404: "Customer not found",
  },
  event: (_input, result) => ({
    type: "privacy.access_requested",
    entityType: "privacy_request",
    entityId: result.request.id,
    payload: { kind: "subject_access" },
  }),
  handler: async ({ db, actor, body }) => {
    if (!isQuillsStorageConfigured()) {
      throw new HTTPException(503, {
        message: "File storage is not configured",
      });
    }
    const [subject] = await db
      .select({
        id: principal.id,
        contactEmail: principal.contactEmail,
        email: user.email,
      })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(principal.id, body.principalId))
      .limit(1);
    if (!subject) {
      throw new HTTPException(404, { message: "Customer not found" });
    }
    const [ws] = await db.select({ slug: settings.slug }).from(settings);
    const fileName = `privacy-export-${ws?.slug ?? "workspace"}-${new Date().toISOString().slice(0, 10)}.zip`;
    const [row] = await db
      .insert(privacyRequests)
      .values({
        type: "access",
        subjectPrincipalId: subject.id,
        subjectEmailHash: hashSubjectEmail(
          subject.email ?? subject.contactEmail,
        ),
        status: "pending",
        requestedByPrincipalId: actor.principalId,
        exportFileName: fileName,
      })
      .returning();
    if (!row) throw new Error("Failed to create privacy access request");
    return { request: toRequestItem(row) };
  },
});

const listRequests = defineQuillsRoute({
  method: "get",
  path: "/privacy/requests",
  operationId: "listQuillsPrivacyRequests",
  summary: "List privacy erasure and access requests",
  action: "manage_settings",
  query: z.object({
    type: z.enum(["erasure", "access"]).optional(),
    limit: pagingNumber(1, 100, 30),
  }),
  response: z.object({
    items: z.array(privacyRequestItemSchema),
  }),
  responseDescription: "Recent privacy requests and compliance receipts",
  handler: async ({ db, query }) => {
    const rows = await db
      .select()
      .from(privacyRequests)
      .where(query.type ? eq(privacyRequests.type, query.type) : undefined)
      .orderBy(desc(privacyRequests.createdAt), desc(privacyRequests.id))
      .limit(query.limit);
    return {
      items: rows.map(toRequestItem),
    };
  },
});

const getRequest = defineQuillsRoute({
  method: "get",
  path: "/privacy/requests/{requestId}",
  operationId: "getQuillsPrivacyRequest",
  summary: "Get one privacy request",
  action: "manage_settings",
  params: requestParams,
  response: privacyRequestItemSchema,
  responseDescription: "Privacy request details",
  errors: { 404: "Privacy request not found" },
  handler: async ({ db, params }) => {
    const [row] = await db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, params.requestId))
      .limit(1);
    if (!row) {
      throw new HTTPException(404, { message: "Privacy request not found" });
    }
    return toRequestItem(row);
  },
});

const downloadRequest = defineQuillsRoute({
  method: "get",
  path: "/privacy/requests/{requestId}/download",
  operationId: "downloadQuillsPrivacyAccessRequest",
  summary:
    "Get a short-lived download URL for a completed subject access export",
  action: "manage_settings",
  params: requestParams,
  response: z.object({
    url: z.string(),
    fileName: z.string(),
    expiresAt: responseTimestamp,
  }),
  responseDescription: "Presigned ZIP download URL",
  errors: {
    404: "Export is not available or has expired",
  },
  handler: async ({ db, params }) => {
    const [row] = await db
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.id, params.requestId),
          eq(privacyRequests.type, "access"),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.status !== "completed" ||
      !row.exportS3Key ||
      (row.exportExpiresAt && row.exportExpiresAt <= new Date())
    ) {
      throw new HTTPException(404, {
        message: "Privacy export is not available or has expired",
      });
    }
    const fileName = row.exportFileName ?? "privacy-export.zip";
    const download = await createDownload({
      storageKey: row.exportS3Key,
      name: fileName,
      contentType: "application/zip",
    });
    return {
      url: download.downloadUrl,
      fileName,
      expiresAt: download.downloadExpiresAt,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...requestAccess)
  .openapi(...listRequests)
  .openapi(...getRequest)
  .openapi(...downloadRequest);
