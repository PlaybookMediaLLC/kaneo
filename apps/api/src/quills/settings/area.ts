import { eq } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { receiptOf, type Receipt } from "./receipt-fields";

// One settings area: a read and a partial update of the workspace settings row.
// The workspace name and slug belong to Kaneo and are never written here.

export type SettingsRow = typeof settings.$inferSelect;
type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];
type Change = Omit<Partial<typeof settings.$inferInsert>, "name" | "slug">;

export function parseJson(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

export const str = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/** Removes undefined keys so a partial patch never clears a stored value. */
export const defined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

export function settingsArea<
  R extends z.ZodObject,
  P extends z.ZodObject,
  A extends "portal" | "branding" | "widget" | "developer" | "labs",
>(area: {
  /** Path segment and event name. */
  name: A;
  /** Title-case name for operation IDs. */
  title: string;
  label: string;
  response: R;
  read: (row: SettingsRow) => z.input<R>;
  patch: P;
  apply: (row: SettingsRow, patch: z.output<P>) => Change;
  /**
   * The fields a receipt may hold (see receipt-fields.ts): only what `apply` writes. Never a secret,
   * a token, a credential, a file key, portal access data, or the Kaneo name or slug.
   */
  receipt: readonly string[];
}) {
  const read = async (db: Db, lock: boolean) => {
    const query = db.select().from(settings).limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw new Error("Quills settings were not initialized");
    return row;
  };
  const get = defineQuillsRoute({
    method: "get",
    path: `/settings/${area.name}` as const,
    operationId: `getQuills${area.title}Settings`,
    summary: `Get the ${area.label} settings`,
    action: "manage_settings",
    response: area.response,
    responseDescription: `The ${area.label} settings`,
    handler: async ({ db }) => area.read(await read(db, false)),
  });
  const update = defineQuillsRoute({
    method: "put",
    path: `/settings/${area.name}` as const,
    operationId: `updateQuills${area.title}Settings`,
    summary: `Update the ${area.label} settings`,
    description: "Fields that are not sent keep their value.",
    action: "manage_settings",
    body: area.patch.refine(
      (patch) => Object.keys(patch).length > 0,
      "Send at least one field",
    ),
    response: area.response.extend({
      receiptId: z.string().nullable().openapi({
        description:
          "The receipt of this change, for POST /settings/receipts/{receiptId}/undo. Null when no field that undo restores changed.",
      }),
    }),
    responseDescription: `The ${area.label} settings`,
    // The receipt goes only into the audit row (events.ts); the response holds its ID only.
    event: ({ workspaceId }, result, raw) => {
      const { receipt } = raw as { receipt?: Receipt | null };
      const { receiptId } = result as { receiptId: string | null };
      return {
        type: `settings.${area.name}_updated` as const,
        entityType: "settings",
        entityId: workspaceId,
        ...(receipt && receiptId ? { receipt, receiptId } : {}),
      };
    },
    handler: async ({ db, body }) => {
      const row = await read(db, true);
      const [updated] = await db
        .update(settings)
        .set(area.apply(row, body as z.output<P>))
        .where(eq(settings.id, row.id))
        .returning();
      const receipt = receiptOf(area.name, area.receipt, row, updated!);
      // The response schema drops `receipt`; the event reads it from the raw result.
      return Object.assign(area.read(updated!), {
        receiptId: receipt && createId("audit_log"),
        receipt,
      });
    },
  });
  return apiRouter<BaseVariables & { workspaceId: string }>()
    .openapi(...get)
    .openapi(...update);
}
