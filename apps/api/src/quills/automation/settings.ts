import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { readSettingsKey, writeSettingsKey } from "../feedback/settings-json";
import { someField } from "../feedback/schemas";

// Workflow settings in the settings metadata, under the source's keys so transferred values keep.
// Storage only: their consumers (parked journeys, AI spam classification) are not ported.

const abandoned = z.object({
  enabled: z.boolean(),
  waitMinutes: z.number().int().min(1).max(60),
  keepIfEmailCaptured: z.boolean(),
});
const ABANDONED_DEFAULT = {
  enabled: false,
  waitMinutes: 5,
  keepIfEmailCaptured: true,
};
const closeSpam = z.object({ enabled: z.boolean() });
const CLOSE_SPAM_DEFAULT = { enabled: false };

/** Each valid stored field over its default; an invalid or missing field reads as the default. */
function read<S extends z.ZodObject>(
  schema: S,
  fallback: z.output<S>,
  stored: unknown,
) {
  const bag = (stored && typeof stored === "object" ? stored : {}) as Record<
    string,
    unknown
  >;
  return schema.parse(
    Object.fromEntries(
      Object.entries(fallback).map(([key, value]) => {
        const field = schema.shape[key]!.safeParse(bag[key]);
        return [key, field.success ? field.data : value];
      }),
    ),
  ) as z.output<S>;
}
const readAbandoned = (stored: unknown) =>
  read(abandoned, ABANDONED_DEFAULT, stored);
const readCloseSpam = (stored: unknown) =>
  read(closeSpam, CLOSE_SPAM_DEFAULT, stored);

const getAbandoned = defineQuillsRoute({
  method: "get",
  path: "/automation/settings/abandoned-auto-close",
  operationId: "getQuillsWorkflowAbandonedAutoClose",
  summary: "Get the abandoned-journey auto-close setting",
  description: "Unset or invalid stored values read as the defaults.",
  action: "manage_settings",
  response: abandoned,
  responseDescription: "The setting",
  handler: async ({ db }) =>
    readAbandoned(
      await readSettingsKey(db, "metadata", "workflowAbandonedAutoClose"),
    ),
});

const setAbandoned = defineQuillsRoute({
  method: "put",
  path: "/automation/settings/abandoned-auto-close",
  operationId: "setQuillsWorkflowAbandonedAutoClose",
  summary: "Set the abandoned-journey auto-close setting",
  description: "Fields left out keep their stored value.",
  action: "manage_settings",
  body: abandoned.partial().refine(someField, "Change at least one field"),
  response: abandoned,
  responseDescription: "The setting",
  event: ({ workspaceId }) => ({
    type: "settings.workflow_abandoned_auto_close_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: ({ db, body }) =>
    writeSettingsKey(db, "metadata", "workflowAbandonedAutoClose", (stored) => {
      const current = readAbandoned(stored);
      return {
        enabled: body.enabled ?? current.enabled,
        waitMinutes: body.waitMinutes ?? current.waitMinutes,
        keepIfEmailCaptured:
          body.keepIfEmailCaptured ?? current.keepIfEmailCaptured,
      };
    }),
});

const getCloseSpam = defineQuillsRoute({
  method: "get",
  path: "/automation/settings/close-spam",
  operationId: "getQuillsWorkflowCloseSpam",
  summary: "Get the close-spam setting",
  description: "Unset or invalid stored values read as the defaults.",
  action: "manage_settings",
  response: closeSpam,
  responseDescription: "The setting",
  handler: async ({ db }) =>
    readCloseSpam(await readSettingsKey(db, "metadata", "workflowCloseSpam")),
});

const setCloseSpam = defineQuillsRoute({
  method: "put",
  path: "/automation/settings/close-spam",
  operationId: "setQuillsWorkflowCloseSpam",
  summary: "Set the close-spam setting",
  action: "manage_settings",
  body: closeSpam,
  response: closeSpam,
  responseDescription: "The setting",
  event: ({ workspaceId }) => ({
    type: "settings.workflow_close_spam_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: ({ db, body }) =>
    writeSettingsKey(db, "metadata", "workflowCloseSpam", () => ({
      enabled: body.enabled,
    })),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getAbandoned)
  .openapi(...setAbandoned)
  .openapi(...getCloseSpam)
  .openapi(...setCloseSpam);
