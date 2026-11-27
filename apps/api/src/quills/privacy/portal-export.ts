import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../openapi";
import { principal, settings, user } from "../../database/quills/schema/auth";
import { privacyRequests } from "../../database/quills/schema/privacy";
import { defineQuillsRoute } from "../framework/define-route";
import { createDownload, isQuillsStorageConfigured } from "../framework/files";
import { principalOf, viewerFor } from "../portal/feedback/viewer";
import { hashSubjectEmail } from "./tombstone";

const portalPrivacyExportSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  fileName: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: nullableResponseTimestamp,
  completedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});

const requestSelfExport = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "post",
  path: "/portal/privacy/export",
  operationId: "requestQuillsPortalPrivacyExport",
  summary: "Request a portable export of your own data",
  description:
    "Authenticated portal customers can request a ZIP archive containing their profile, feedback, conversations, attachments, tickets, and subscriptions (rate-limited to 5 requests per hour).",
  action: "create",
  rateLimit: { limit: 5, windowSeconds: 3600, per: "caller" },
  response: portalPrivacyExportSchema,
  responseDescription: "The queued self-service export request",
  errors: {},
  event: (_input, result) => ({
    type: "privacy.access_requested",
    entityType: "privacy_request",
    entityId: result.id,
    payload: { kind: "portal_self_export" },
  }),
  handler: async ({ db, caller }) => {
    if (!isQuillsStorageConfigured()) {
      throw new HTTPException(503, {
        message: "File storage is not configured",
      });
    }
    const viewer = await viewerFor(db, "portal", caller);
    if (!viewer.signedIn) {
      throw new HTTPException(401, { message: "Sign in to export your data" });
    }
    const me = principalOf(viewer);
    const [subject] = await db
      .select({
        contactEmail: principal.contactEmail,
        email: user.email,
      })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(principal.id, me))
      .limit(1);
    const [ws] = await db.select({ slug: settings.slug }).from(settings);
    const fileName = `my-data-${ws?.slug ?? "workspace"}-${new Date().toISOString().slice(0, 10)}.zip`;
    const [row] = await db
      .insert(privacyRequests)
      .values({
        type: "access",
        subjectPrincipalId: me,
        subjectEmailHash: hashSubjectEmail(
          subject?.email ?? subject?.contactEmail,
        ),
        status: "pending",
        requestedByPrincipalId: me,
        exportFileName: fileName,
      })
      .returning();
    if (!row) throw new Error("Failed to create portal privacy export");
    return {
      id: row.id,
      status: row.status,
      fileName: row.exportFileName,
      downloadUrl: null,
      expiresAt: row.exportExpiresAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  },
});

const getSelfExport = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/portal/privacy/exports/{requestId}",
  operationId: "getQuillsPortalPrivacyExport",
  summary: "Check status and get download URL for your own privacy export",
  action: "read",
  params: z.object({
    requestId: flexibleToTypeIdSchema("privacy_request"),
  }),
  response: portalPrivacyExportSchema,
  responseDescription: "Status and download link for the caller's own export",
  errors: {
    404: "Privacy export not found",
  },
  handler: async ({ db, caller, params }) => {
    const viewer = await viewerFor(db, "portal", caller);
    if (!viewer.signedIn || !viewer.principalId) {
      throw new HTTPException(401, {
        message: "Sign in to access your export",
      });
    }
    const [row] = await db
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.id, params.requestId),
          eq(privacyRequests.type, "access"),
          eq(privacyRequests.subjectPrincipalId, viewer.principalId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new HTTPException(404, { message: "Privacy export not found" });
    }
    let downloadUrl: string | null = null;
    if (
      row.status === "completed" &&
      row.exportS3Key &&
      (!row.exportExpiresAt || row.exportExpiresAt > new Date())
    ) {
      const download = await createDownload({
        storageKey: row.exportS3Key,
        name: row.exportFileName ?? "my-data.zip",
        contentType: "application/zip",
      });
      downloadUrl = download.downloadUrl;
    }
    return {
      id: row.id,
      status: row.status,
      fileName: row.exportFileName,
      downloadUrl,
      expiresAt: row.exportExpiresAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  },
});

export default apiRouter()
  .openapi(...requestSelfExport)
  .openapi(...getSelfExport);
