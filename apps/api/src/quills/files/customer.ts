import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import type { QuillsCaller } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  createUpload,
  holdVerifiedUpload,
  imageUrl,
  uploadedObject,
  uploadRequest,
  uploadResponse,
  verifyUpload,
} from "../framework/files";
import { httpUrl, requirePortal } from "../portal/feedback/viewer";
import { requirePortalAccess } from "../portal/gate";
import { readConfig } from "../settings/widget";
import {
  fileBody,
  fileEvent,
  registerFile,
  registeredFile,
  registrationErrors,
} from "./files";

// Portal and widget uploads and the customer avatar. A key is derived on the server from the
// workspace, the purpose and the caller's customer ID, so a customer verifies and registers only
// its own uploads. `prepare` runs the gate and finds the customer; signing and verification run in
// `call`, outside any transaction.

const attachments = ["customer_file", "customer_image"] as const;
/** Uploads per client and workspace: the source's 20 a minute. */
const perMinute = { limit: 20, windowSeconds: 60 };

/**
 * The caller's customer ID. A portal account needs its customer profile here first (the source's
 * 403); a removed customer keeps the profile row but has no principal.
 */
function owner(caller: QuillsCaller) {
  if (!caller.customerId || !caller.principalId)
    throw new HTTPException(403, {
      message: "Create your customer profile first",
    });
  return caller.customerId;
}

/**
 * Widget attachments: the widget's messenger or tickets tab is on, and the host app identified the
 * visitor. Stricter than the source, which also lets an anonymous session upload: customer files
 * have no consumer and no sweep yet, so an anonymous session must not fill storage.
 */
async function widgetUploader(db: Database, caller: QuillsCaller) {
  const customerId = owner(caller);
  const [row] = await db.select().from(settings).limit(1);
  const config = row && readConfig(row);
  if (!config?.enabled || !(config.tabs.messenger || config.tabs.tickets))
    throw new HTTPException(404, { message: "Widget attachments not found" });
  const [person] = await db
    .select({ type: principal.type })
    .from(principal)
    .where(eq(principal.id, caller.principalId!))
    .limit(1);
  if (person?.type !== "user")
    throw new HTTPException(403, {
      message: "The host app must identify the visitor first",
    });
  return customerId;
}

const portalUpload = defineQuillsRoute({
  audience: "portal",
  method: "post",
  path: "/portal/uploads",
  operationId: "createQuillsPortalUpload",
  summary: "Request an upload URL for a portal attachment or avatar",
  description:
    "Returns a presigned PUT for a key in the caller's own namespace. Register an attachment with POST /portal/files and an avatar with PUT /user/avatar; an unregistered upload is not a reference.",
  action: "create",
  rateLimit: perMinute,
  body: uploadRequest([...attachments, "customer_avatar"]),
  response: uploadResponse,
  responseDescription: "Presigned upload",
  errors: {
    400: "Unsupported type or size",
    403: "No customer profile, or portal access denied",
  },
  event: { none: "Signs an upload URL; a later request registers it" },
  prepare: async ({ db, caller }) => {
    await requirePortalAccess(db, caller);
    return owner(caller);
  },
  call: (customerId, { body, workspaceId }) =>
    createUpload(workspaceId, body, customerId),
  handler: async ({ called }) => called,
});

const portalFile = defineQuillsRoute({
  audience: "portal",
  method: "post",
  path: "/portal/files",
  operationId: "createQuillsPortalFiles",
  summary: "Register a portal attachment",
  description:
    "Verifies an object that the caller uploaded with POST /portal/uploads and registers it. Idempotent per key.",
  action: "create",
  rateLimit: perMinute,
  body: fileBody,
  response: registeredFile,
  responseDescription: "Registered file",
  errors: {
    ...registrationErrors,
    403: "No customer profile, or portal access denied",
  },
  event: fileEvent,
  prepare: async ({ db, caller }) => {
    await requirePortalAccess(db, caller);
    return owner(caller);
  },
  call: (customerId, { body, workspaceId }) =>
    verifyUpload(workspaceId, attachments, body, {
      digest: true,
      customer: customerId,
    }),
  // The gate again: the portal may have closed while the object was verified.
  handler: async ({ db, caller, body, called }) => {
    await requirePortalAccess(db, caller);
    return registerFile(db, called, {
      name: body.name,
      declaredType: body.contentType,
      source: "portal",
      uploadedById: caller.principalId,
    });
  },
});

const widgetUpload = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/widget/uploads",
  operationId: "createQuillsWidgetUpload",
  summary: "Request an upload URL for a widget attachment",
  description:
    "Returns a presigned PUT for a key in the visitor's own namespace. Register it with POST /widget/files. Needs the messenger or tickets tab and a visitor that the host app identified.",
  action: "create",
  rateLimit: perMinute,
  body: uploadRequest(attachments),
  response: uploadResponse,
  responseDescription: "Presigned upload",
  errors: {
    400: "Unsupported type or size",
    403: "Anonymous visitor",
    404: "Widget attachments are off",
  },
  event: { none: "Signs an upload URL; a later request registers it" },
  prepare: ({ db, caller }) => widgetUploader(db, caller),
  call: (customerId, { body, workspaceId }) =>
    createUpload(workspaceId, body, customerId),
  handler: async ({ called }) => called,
});

const widgetFile = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/widget/files",
  operationId: "createQuillsWidgetFiles",
  summary: "Register a widget attachment",
  description:
    "Verifies an object that the visitor uploaded with POST /widget/uploads and registers it. Idempotent per key.",
  action: "create",
  rateLimit: perMinute,
  body: fileBody,
  response: registeredFile,
  responseDescription: "Registered file",
  errors: {
    ...registrationErrors,
    403: "Anonymous visitor",
    404: "Upload not found, or widget attachments are off",
  },
  event: fileEvent,
  prepare: ({ db, caller }) => widgetUploader(db, caller),
  call: (customerId, { body, workspaceId }) =>
    verifyUpload(workspaceId, attachments, body, {
      digest: true,
      customer: customerId,
    }),
  handler: async ({ db, caller, body, called }) => {
    await widgetUploader(db, caller);
    return registerFile(db, called, {
      name: body.name,
      declaredType: body.contentType,
      source: "visitor",
      uploadedById: caller.principalId,
    });
  },
});

const avatarResult = z.object({
  changed: z.boolean(),
  principalId: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
const avatarEvent = (_input: unknown, result: z.output<typeof avatarResult>) =>
  result.changed && {
    type: "customer.profile_updated" as const,
    entityType: "principal" as const,
    entityId: result.principalId!,
  };

const saveAvatar = defineQuillsRoute({
  audience: "portal",
  method: "put",
  path: "/user/avatar",
  operationId: "saveQuillsCustomerAvatar",
  summary: "Set the caller's avatar to an uploaded image",
  description:
    "Verifies an image that the caller uploaded with POST /portal/uploads (purpose customer_avatar). The previous uploaded avatar is queued for cleanup.",
  action: "update",
  rateLimit: { limit: 10, windowSeconds: 600 },
  body: uploadedObject,
  response: avatarResult,
  responseDescription: "The caller's avatar",
  errors: { 403: "No customer profile", 404: "Upload not found" },
  event: avatarEvent,
  prepare: async ({ db, caller }) => {
    await requirePortal(db);
    return owner(caller);
  },
  // Signing may resolve provider credentials, so the URL is signed here too, outside the transaction.
  call: async (customerId, { body, workspaceId }) => {
    const upload = await verifyUpload(workspaceId, ["customer_avatar"], body, {
      customer: customerId,
    });
    return { upload, avatarUrl: await imageUrl(upload.key) };
  },
  handler: async ({ db, caller, called }) => {
    await requirePortal(db);
    await holdVerifiedUpload(db, called.upload);
    const changed = await db
      .update(customer)
      .set({ imageKey: called.upload.key })
      .where(eq(customer.id, owner(caller)))
      .returning({ id: customer.id });
    return {
      changed: changed.length > 0,
      principalId: caller.principalId,
      avatarUrl: called.avatarUrl,
    };
  },
});

const deleteAvatar = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/user/avatar",
  operationId: "deleteQuillsCustomerAvatar",
  summary: "Remove the caller's uploaded avatar",
  description:
    "The uploaded image is queued for cleanup. An avatar from the sign-in provider stays.",
  action: "update",
  rateLimit: { limit: 10, windowSeconds: 600 },
  response: avatarResult,
  responseDescription: "The caller's avatar",
  event: avatarEvent,
  handler: async ({ db, caller }) => {
    await requirePortal(db);
    // A removed customer keeps its profile row but has no principal: nothing of it is changed here.
    if (!caller.customerId || !caller.principalId)
      return { changed: false, principalId: null, avatarUrl: null };
    const changed = await db
      .update(customer)
      .set({ imageKey: null })
      .where(
        and(eq(customer.id, caller.customerId), isNotNull(customer.imageKey)),
      )
      .returning({ id: customer.id });
    const [row] = await db
      .select({ image: customer.image })
      .from(customer)
      .where(eq(customer.id, caller.customerId));
    return {
      changed: changed.length > 0,
      principalId: caller.principalId,
      // The sign-in provider's image, which the profile shows next.
      avatarUrl: httpUrl(row?.image ?? null),
    };
  },
});

export default apiRouter()
  .openapi(...portalUpload)
  .openapi(...portalFile)
  .openapi(...widgetUpload)
  .openapi(...widgetFile)
  .openapi(...saveAvatar)
  .openapi(...deleteAvatar);
