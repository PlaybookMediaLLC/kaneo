import { isNotNull } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import {
  holdVerifiedUpload,
  uploadedObject,
  verifyUpload,
} from "../framework/files";

// The settings columns that hold an object key. The quills_storage_changes trigger queues
// a replaced or cleared key for cleanup in the same transaction.
export const fields = {
  logo: {
    path: "/settings/logo",
    label: "logo",
    property: "logoKey",
    save: "saveQuillsLogoKey",
    remove: "deleteQuillsLogo",
    updated: "settings.logo_updated",
    removed: "settings.logo_removed",
  },
  favicon: {
    path: "/settings/favicon",
    label: "favicon",
    property: "faviconKey",
    save: "saveQuillsFaviconKey",
    remove: "deleteQuillsFavicon",
    updated: "settings.favicon_updated",
    removed: "settings.favicon_removed",
  },
  header_logo: {
    path: "/settings/header-logo",
    label: "header logo",
    property: "headerLogoKey",
    save: "saveQuillsHeaderLogoKey",
    remove: "deleteQuillsHeaderLogo",
    updated: "settings.header_logo_updated",
    removed: "settings.header_logo_removed",
  },
} as const;
type Purpose = keyof typeof fields;
const changed = z.object({ changed: z.boolean() });

const saveKey = (purpose: Purpose) => {
  const field = fields[purpose];
  const column = settings[field.property];
  return defineQuillsRoute({
    method: "put",
    path: field.path,
    operationId: field.save,
    summary: `Set the workspace ${field.label} to an uploaded image`,
    description: `Verifies an image uploaded with a URL from POST /files/settings-uploads (purpose ${purpose}). The replaced key is queued for cleanup.`,
    action: "manage_settings",
    body: uploadedObject,
    response: changed,
    responseDescription: "Whether the key changed",
    errors: { 404: "Upload not found" },
    load: ({ body, workspaceId }) => verifyUpload(workspaceId, [purpose], body),
    event: ({ workspaceId }, result) =>
      result.changed && {
        type: field.updated,
        entityType: "settings",
        entityId: workspaceId,
      },
    handler: async ({ db, loaded }) => {
      // Row lock first, then the object lock: the same order as the storage trigger.
      const [current] = await db
        .select({ key: column })
        .from(settings)
        .for("update");
      if (current?.key === loaded.key) return { changed: false };
      await holdVerifiedUpload(db, loaded);
      await db.update(settings).set({ [field.property]: loaded.key });
      return { changed: true };
    },
  });
};

const removeKey = (purpose: Purpose) => {
  const field = fields[purpose];
  const column = settings[field.property];
  return defineQuillsRoute({
    method: "delete",
    path: field.path,
    operationId: field.remove,
    summary: `Remove the workspace ${field.label}`,
    description: "The removed key is queued for cleanup.",
    action: "manage_settings",
    response: changed,
    responseDescription: "Whether a key was removed",
    event: ({ workspaceId }, result) =>
      result.changed && {
        type: field.removed,
        entityType: "settings",
        entityId: workspaceId,
      },
    handler: async ({ db }) => ({
      changed:
        (
          await db
            .update(settings)
            .set({ [field.property]: null })
            .where(isNotNull(column))
            .returning({ id: settings.id })
        ).length > 0,
    }),
  });
};

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...saveKey("logo"))
  .openapi(...removeKey("logo"))
  .openapi(...saveKey("favicon"))
  .openapi(...removeKey("favicon"))
  .openapi(...saveKey("header_logo"))
  .openapi(...removeKey("header_logo"));
