import { eq } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { notificationPreferences } from "../../database/quills/schema/notifications";
import { defineQuillsRoute } from "../framework/define-route";

// The caller's own preferences. `read` is enough: a viewer controls what is sent to them.
// The stored matrix is `{ [type]: { inApp, email, push } }`; the API lists it as one entry per type.
const override = z
  .object({
    type: z.string().min(1).max(64),
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    push: z.boolean().optional(),
  })
  .strict();
const matrix = z.array(override).max(50);
const preferences = z
  .object({
    emailStatusChange: z.boolean(),
    emailNewComment: z.boolean(),
    emailMuted: z.boolean(),
    matrix: z.array(
      z.object({
        type: z.string(),
        inApp: z.boolean().nullable(),
        email: z.boolean().nullable(),
        push: z.boolean().nullable(),
      }),
    ),
  })
  .openapi("QuillsNotificationPreferences");
type Stored = (typeof notificationPreferences.$inferSelect)["matrix"];
const columns = {
  emailStatusChange: notificationPreferences.emailStatusChange,
  emailNewComment: notificationPreferences.emailNewComment,
  emailMuted: notificationPreferences.emailMuted,
  matrix: notificationPreferences.matrix,
};
const view = (row: {
  emailStatusChange: boolean;
  emailNewComment: boolean;
  emailMuted: boolean;
  matrix: Stored;
}) => ({
  ...row,
  matrix: Object.entries(row.matrix ?? {}).map(([type, cell]) => ({
    type,
    inApp: cell?.inApp ?? null,
    email: cell?.email ?? null,
    push: cell?.push ?? null,
  })),
});

const getPreferences = defineQuillsRoute({
  method: "get",
  path: "/notification-preferences",
  operationId: "getQuillsNotificationPreferences",
  summary: "Get the caller's Quills notification preferences",
  description: "Defaults apply until the caller saves preferences.",
  action: "read",
  response: preferences,
  responseDescription: "The caller's preferences",
  errors: { 403: "Insufficient permission" },
  handler: async ({ db, actor }) => {
    const [row] = await db
      .select(columns)
      .from(notificationPreferences)
      .where(eq(notificationPreferences.principalId, actor.principalId));
    return view(
      row ?? {
        emailStatusChange: true,
        emailNewComment: true,
        emailMuted: false,
        matrix: null,
      },
    );
  },
});

const updatePreferences = defineQuillsRoute({
  method: "patch",
  path: "/notification-preferences",
  operationId: "updateQuillsNotificationPreferences",
  summary: "Update the caller's Quills notification preferences",
  description:
    "`matrix` replaces the stored overrides: send every type and channel override.",
  action: "read",
  body: z
    .object({
      emailStatusChange: z.boolean().optional(),
      emailNewComment: z.boolean().optional(),
      emailMuted: z.boolean().optional(),
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
      matrix:
        body.matrix &&
        Object.fromEntries(
          body.matrix.map(({ type, inApp, email, push }) => [
            type,
            { inApp, email, push },
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
