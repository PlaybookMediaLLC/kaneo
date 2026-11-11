import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { someField } from "./schemas";
import { readSettingsKey, writeSettingsKey } from "./settings-json";

// Stored in settings.metadata under this key, as in Quackback's settings.changelog.ts.
const KEY = "changelogSettings";
const audience = z.enum(["public", "authenticated"]);
const stored = z
  .object({
    audience,
    collaborationDisabled: z.boolean(),
    autoSubscribe: z.boolean(),
    emailsDisabled: z.boolean(),
  })
  .partial();
const response = z
  .object({
    audience,
    collaborationDisabled: z.boolean(),
    autoSubscribe: z.boolean(),
    emailsDisabled: z.boolean(),
  })
  .openapi("QuillsChangelogSettings");
const DEFAULTS: z.output<typeof response> = {
  audience: "public",
  collaborationDisabled: false,
  autoSubscribe: true,
  emailsDisabled: false,
};
/** Stored values over the defaults; an invalid stored value reads as the default. */
const resolve = (value: unknown) => ({
  ...DEFAULTS,
  ...stored.safeParse(value).data,
});

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/changelog/settings",
  operationId: "getQuillsChangelogSettings",
  summary: "Get changelog settings",
  action: "read",
  response,
  responseDescription: "Changelog settings with defaults applied",
  handler: async ({ db }) =>
    resolve(await readSettingsKey(db, "metadata", KEY)),
});

const updateSettings = defineQuillsRoute({
  method: "patch",
  path: "/changelog/settings",
  operationId: "updateQuillsChangelogSettings",
  summary: "Update changelog settings",
  description:
    "Changes only the changelog settings key; other workspace settings stay as stored.",
  action: "manage_settings",
  body: z
    .object({
      audience: audience.optional(),
      autoSubscribe: z.boolean().optional(),
      emailsDisabled: z.boolean().optional(),
    })
    .refine(someField, "Change at least one field"),
  response,
  responseDescription: "The updated changelog settings",
  errors: { 409: "Stored settings are not a JSON object" },
  event: (_input, result) => ({
    type: "settings.changelog_updated",
    entityType: "settings",
    entityId: "changelog",
    payload: {
      audience: result.audience,
      autoSubscribe: String(result.autoSubscribe),
      emailsDisabled: String(result.emailsDisabled),
    },
  }),
  handler: async ({ db, body }) => {
    const changes = Object.fromEntries(
      Object.entries({
        audience: body.audience,
        autoSubscribe: body.autoSubscribe,
        emailsDisabled: body.emailsDisabled,
      }).filter(([, value]) => value !== undefined),
    );
    return resolve(
      await writeSettingsKey(db, "metadata", KEY, (current) => ({
        ...(current && typeof current === "object" ? current : {}),
        ...changes,
      })),
    );
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSettings)
  .openapi(...updateSettings);
