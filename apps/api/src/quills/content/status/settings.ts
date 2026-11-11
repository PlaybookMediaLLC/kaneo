import { apiRouter, z, type BaseVariables } from "../../../openapi";
import { defineQuillsRoute } from "../../framework/define-route";
import { idList, someField } from "../../feedback/schemas";
import {
  readSettingsKey,
  writeSettingsKey,
} from "../../feedback/settings-json";
import { defined } from "../../settings/area";
import { requireSegments, type Db } from "../help-center/shared";

// Stored in settings.metadata under this key, as in Quackback's settings.status.ts.
const KEY = "statusSettings";
const audience = z.enum(["public", "authenticated", "segments"]);
// Each field falls back on its own, so one bad stored value cannot reset the others on a write.
const stored = z.object({
  enabled: z.boolean().catch(false),
  audience: audience.catch("public"),
  allowedSegmentIds: z.array(z.string()).catch([]),
  emailsDisabled: z.boolean().catch(false),
  pageDescription: z.string().nullable().catch(null),
});
const response = z
  .object({
    enabled: z.boolean().openapi({
      description:
        "The page publish switch; the statusPage module flag also applies",
    }),
    audience,
    allowedSegmentIds: z.array(z.string()),
    emailsDisabled: z.boolean(),
    pageDescription: z.string().nullable(),
  })
  .openapi("QuillsStatusSettings");
/** Stored values over the defaults; an invalid stored value reads as its default. */
const resolve = (value: unknown) =>
  stored.parse(value && typeof value === "object" ? value : {});
export const readStatusSettings = async (db: Db) =>
  resolve(await readSettingsKey(db, "metadata", KEY));

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/status/settings",
  operationId: "getQuillsStatusSettings",
  summary: "Get status page settings",
  action: "read",
  response,
  responseDescription: "Status page settings with defaults applied",
  handler: ({ db }) => readStatusSettings(db),
});

const updateSettings = defineQuillsRoute({
  method: "patch",
  path: "/status/settings",
  operationId: "updateQuillsStatusSettings",
  summary: "Update status page settings",
  description:
    "Changes only the status settings key; other workspace settings stay as stored.",
  action: "manage_settings",
  body: z
    .object({
      enabled: z.boolean().optional(),
      audience: audience.optional(),
      allowedSegmentIds: idList("segment").optional(),
      emailsDisabled: z.boolean().optional(),
      pageDescription: z.string().trim().max(500).nullable().optional(),
    })
    .refine(someField, "Change at least one field"),
  response,
  responseDescription: "The updated status page settings",
  errors: {
    404: "Segment not found",
    409: "Stored settings are not a JSON object",
  },
  event: (_input, result) => ({
    type: "settings.status_updated",
    entityType: "settings",
    entityId: "status",
    payload: {
      enabled: String(result.enabled),
      audience: result.audience,
      emailsDisabled: String(result.emailsDisabled),
    },
  }),
  handler: async ({ db, body }) => {
    await requireSegments(db, body.allowedSegmentIds);
    const changes = defined({
      enabled: body.enabled,
      audience: body.audience,
      allowedSegmentIds: body.allowedSegmentIds,
      emailsDisabled: body.emailsDisabled,
      pageDescription:
        body.pageDescription === undefined
          ? undefined
          : body.pageDescription || null,
    });
    return resolve(
      await writeSettingsKey(db, "metadata", KEY, (current) => ({
        ...resolve(current),
        ...changes,
      })),
    );
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSettings)
  .openapi(...updateSettings);
