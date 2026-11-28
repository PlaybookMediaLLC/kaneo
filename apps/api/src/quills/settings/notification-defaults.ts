import { apiRouter, z, type BaseVariables } from "../../openapi";
import { readSettingsKey, writeSettingsKey } from "../feedback/settings-json";
import { defineQuillsRoute } from "../framework/define-route";

const channelOverride = z
  .object({
    type: z.string().min(1).max(64),
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    slackDm: z.boolean().optional(),
  })
  .strict();

const defaultsSchema = z.object({
  digestFrequency: z.enum(["off", "hourly", "daily"]).default("off"),
  matrix: z.array(channelOverride).max(50).default([]),
});

function readDefaults(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { digestFrequency: "off" as const, matrix: [] };
  }
  const bag = raw as Record<string, unknown>;
  const digestFrequency: "off" | "hourly" | "daily" =
    bag.digestFrequency === "hourly"
      ? "hourly"
      : bag.digestFrequency === "daily"
        ? "daily"
        : "off";
  const matrixObj =
    bag.matrix && typeof bag.matrix === "object" && !Array.isArray(bag.matrix)
      ? (bag.matrix as Record<string, Record<string, boolean | undefined>>)
      : {};
  const matrix = Object.entries(matrixObj).map(([type, cell]) => ({
    type,
    ...(typeof cell?.inApp === "boolean" ? { inApp: cell.inApp } : {}),
    ...(typeof cell?.email === "boolean" ? { email: cell.email } : {}),
    ...(typeof cell?.push === "boolean" ? { push: cell.push } : {}),
    ...(typeof cell?.slackDm === "boolean" ? { slackDm: cell.slackDm } : {}),
  }));
  return { digestFrequency, matrix };
}

const getDefaults = defineQuillsRoute({
  method: "get",
  path: "/settings/notification-defaults",
  operationId: "getQuillsNotificationDefaults",
  summary: "Get workspace-wide teammate notification defaults (#321)",
  description:
    "Workspace defaults apply to teammates who have not saved a personal override for a given event type and channel.",
  action: "read",
  response: defaultsSchema,
  responseDescription: "Workspace notification defaults",
  handler: async ({ db }) =>
    readDefaults(await readSettingsKey(db, "metadata", "notificationDefaults")),
});

const setDefaults = defineQuillsRoute({
  method: "put",
  path: "/settings/notification-defaults",
  operationId: "setQuillsNotificationDefaults",
  summary: "Set workspace-wide teammate notification defaults (#321)",
  description:
    "Updates defaults without overwriting any teammate's personal notification preferences.",
  action: "manage_settings",
  body: defaultsSchema,
  response: defaultsSchema,
  responseDescription: "The saved workspace notification defaults",
  event: ({ workspaceId }) => ({
    type: "settings.notification_defaults_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    const stored = {
      digestFrequency: body.digestFrequency,
      matrix: Object.fromEntries(
        body.matrix.map(({ type, inApp, email, push, slackDm }) => [
          type,
          { inApp, email, push, slackDm },
        ]),
      ),
    };
    await writeSettingsKey(
      db,
      "metadata",
      "notificationDefaults",
      () => stored,
    );
    return readDefaults(stored);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getDefaults)
  .openapi(...setDefaults);
