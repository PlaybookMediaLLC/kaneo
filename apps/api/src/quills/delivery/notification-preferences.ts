import { eq } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { notificationPreferences } from "../../database/quills/schema/notifications";
import { readSettingsKey } from "../feedback/settings-json";
import { defineQuillsRoute } from "../framework/define-route";

// The caller's own preferences. `read` is enough: a viewer controls what is sent to them.
// The stored matrix is `{ [type]: { inApp, email, push, slackDm } }`; the API lists it as one entry per type.
const digestFrequencySchema = z.enum(["off", "hourly", "daily"]);
const override = z
  .object({
    type: z.string().min(1).max(64),
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    slackDm: z.boolean().optional(),
  })
  .strict();
const matrix = z.array(override).max(50);
const preferences = z
  .object({
    emailStatusChange: z.boolean(),
    emailNewComment: z.boolean(),
    emailMuted: z.boolean(),
    digestFrequency: digestFrequencySchema,
    matrix: z.array(
      z.object({
        type: z.string(),
        inApp: z.boolean().nullable(),
        email: z.boolean().nullable(),
        push: z.boolean().nullable(),
        slackDm: z.boolean().nullable(),
      }),
    ),
  })
  .openapi("QuillsNotificationPreferences");
type Stored = (typeof notificationPreferences.$inferSelect)["matrix"];
const columns = {
  emailStatusChange: notificationPreferences.emailStatusChange,
  emailNewComment: notificationPreferences.emailNewComment,
  emailMuted: notificationPreferences.emailMuted,
  digestFrequency: notificationPreferences.digestFrequency,
  matrix: notificationPreferences.matrix,
};
const view = (row: {
  emailStatusChange: boolean;
  emailNewComment: boolean;
  emailMuted: boolean;
  digestFrequency: "off" | "hourly" | "daily";
  matrix: Stored;
}) => ({
  ...row,
  matrix: Object.entries(row.matrix ?? {}).map(([type, cell]) => ({
    type,
    inApp: cell?.inApp ?? null,
    email: cell?.email ?? null,
    push: cell?.push ?? null,
    slackDm: cell?.slackDm ?? null,
  })),
});

const getPreferences = defineQuillsRoute({
  method: "get",
  path: "/notification-preferences",
  operationId: "getQuillsNotificationPreferences",
  summary: "Get the caller's Quills notification preferences",
  description:
    "Quiet defaults and workspace defaults apply until the caller saves personal preferences.",
  action: "read",
  response: preferences,
  responseDescription: "The caller's preferences",
  errors: { 403: "Insufficient permission" },
  handler: async ({ db, actor }) => {
    const [row] = await db
      .select(columns)
      .from(notificationPreferences)
      .where(eq(notificationPreferences.principalId, actor.principalId));
    if (row) return view(row);
    const raw = await readSettingsKey(db, "metadata", "notificationDefaults");
    const rawDigest =
      raw && typeof raw === "object"
        ? (raw as { digestFrequency?: unknown }).digestFrequency
        : undefined;
    const digestFrequency: "off" | "hourly" | "daily" =
      rawDigest === "hourly" || rawDigest === "daily" ? rawDigest : "off";
    return view({
      emailStatusChange: true,
      emailNewComment: true,
      emailMuted: false,
      digestFrequency,
      matrix: null,
    });
  },
});

const updatePreferences = defineQuillsRoute({
  method: "patch",
  path: "/notification-preferences",
  operationId: "updateQuillsNotificationPreferences",
  summary: "Update the caller's Quills notification preferences",
  description:
    "`matrix` replaces the stored overrides: send every type and channel override. Supports inApp, email, push, slackDm, and digestFrequency (#321).",
  action: "read",
  body: z
    .object({
      emailStatusChange: z.boolean().optional(),
      emailNewComment: z.boolean().optional(),
      emailMuted: z.boolean().optional(),
      digestFrequency: digestFrequencySchema.optional(),
      matrix: matrix.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Nothing to update"),
  response: preferences,
  responseDescription: "The saved preferences",
  errors: { 403: "Insufficient permission" },
  event: { none: "The caller's own preferences; no shared record changes." },
  handler: async ({ db, actor, body }) => {
    const fields = {
      emailStatusChange: body.emailStatusChange,
      emailNewComment: body.emailNewComment,
      emailMuted: body.emailMuted,
      digestFrequency: body.digestFrequency,
      matrix:
        body.matrix &&
        Object.fromEntries(
          body.matrix.map(({ type, inApp, email, push, slackDm }) => [
            type,
            { inApp, email, push, slackDm },
          ]),
        ),
    };
    const [row] = await db
      .insert(notificationPreferences)
      .values({ principalId: actor.principalId, ...fields })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.workspaceId,
          notificationPreferences.principalId,
        ],
        set: { ...fields, updatedAt: new Date() },
      })
      .returning(columns);
    return view(row!);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getPreferences)
  .openapi(...updatePreferences);
