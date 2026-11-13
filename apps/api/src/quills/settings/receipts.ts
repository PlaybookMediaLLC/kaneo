import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toUuid } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { auditLog } from "../../database/quills/schema/audit-log";
import { settings } from "../../database/quills/schema/auth";
import { importRuns } from "../../database/quills/schema/import-runs";
import { defineQuillsRoute } from "../framework/define-route";
import { brandingReceipt } from "./branding";
import { developerReceipt } from "./developer";
import { labsReceipt } from "./labs";
import { portalReceipt } from "./portal";
import {
  receiptValue,
  restoredColumns,
  sameValue,
  type Receipt,
} from "./receipt-fields";
import { widgetReceipt } from "./widget";

// Settings undo (decision D11). A receipt is the metadata of a settings write's own audit row. Undo
// restores its `before` values and records a new `settings.undone` row; it never edits the receipt.

const allowlists: Record<string, readonly string[]> = {
  portal: portalReceipt,
  branding: brandingReceipt,
  widget: widgetReceipt,
  developer: developerReceipt,
  labs: labsReceipt,
};
const stored = z.object({
  area: z.enum(Object.keys(allowlists) as [string, ...string[]]),
  before: z.record(z.string(), z.json()),
  after: z.record(z.string(), z.json()),
});
const notFound = () =>
  new HTTPException(404, { message: "Settings receipt not found" });
const conflict = (message: string) => new HTTPException(409, { message });

const undo = defineQuillsRoute({
  method: "post",
  path: "/settings/receipts/{receiptId}/undo",
  operationId: "createQuillsSettingsReceiptsUndo",
  summary: "Undo a settings change",
  description:
    "Restores the values that a settings update changed. receiptId is the update's receiptId. 409 when the change was already undone, when a later change or undo in the area touched the same field, when a field no longer holds the value the change wrote, or when the receipt came in with a workspace import.",
  action: "manage_settings",
  params: z.object({ receiptId: flexibleToTypeIdSchema("audit") }),
  response: z.object({
    id: z.string(),
    area: z.string(),
    undoneAt: responseTimestamp,
  }),
  responseDescription: "The undone change",
  errors: {
    404: "Settings receipt not found",
    409: "The change cannot be undone",
  },
  // The reversed receipt goes only into the new audit row, so a later undo sees this one.
  event: ({ params }, _result, raw) => ({
    type: "settings.undone",
    entityType: "settings",
    entityId: params.receiptId,
    receipt: (raw as { receipt: Receipt }).receipt,
  }),
  handler: async ({ db, params, workspaceId }) => {
    // Every settings write locks this row too, so writes and undos run one at a time.
    const [row] = await db.select().from(settings).limit(1).for("update");
    if (!row) throw new Error("Quills settings were not initialized");
    const [entry] = await db
      .select({
        eventType: auditLog.eventType,
        targetId: auditLog.targetId,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(eq(auditLog.id, params.receiptId))
      .limit(1);
    const parsed = stored.safeParse(
      (entry?.metadata as { receipt?: unknown } | null)?.receipt,
    );
    if (
      !entry ||
      !parsed.success ||
      entry.eventType !== `settings.${parsed.data.area}_updated`
    )
      throw notFound();
    const receipt = parsed.data;
    // Compared in SQL: a JavaScript Date would drop the microseconds.
    const writtenAt = sql`(select r.occurred_at from ${auditLog} r where r.id = ${toUuid(params.receiptId)}::uuid)`;
    // An import copies audit rows unchanged. A settings write names its own workspace, and
    // import_runs never travels in an archive, so it dates this workspace's own imports.
    const [imported] = await db
      .select({ id: importRuns.id })
      .from(importRuns)
      .where(
        and(
          eq(importRuns.source, "api"),
          sql`${importRuns.createdAt} >= ${writtenAt}`,
        ),
      )
      .limit(1);
    if (entry.targetId !== workspaceId || imported)
      throw conflict("This change came with a workspace import.");
    const keys = [
      ...new Set([
        ...Object.keys(receipt.before),
        ...Object.keys(receipt.after),
      ]),
    ];
    if (
      !keys.length ||
      keys.some((key) => !allowlists[receipt.area]!.includes(key))
    )
      throw conflict("This change cannot be undone.");
    const [undone] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, "settings.undone"),
          eq(auditLog.targetId, params.receiptId),
        ),
      )
      .limit(1);
    if (undone) throw conflict("This change was already undone.");
    const touched = sql`array[${sql.join(
      keys.map((key) => sql`${key}`),
      sql`, `,
    )}]::text[]`;
    const [later] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          inArray(auditLog.eventType, [entry.eventType, "settings.undone"]),
          sql`${auditLog.occurredAt} > ${writtenAt}`,
          sql`${auditLog.metadata}->'receipt'->>'area' = ${receipt.area}`,
          sql`(${auditLog.metadata}->'receipt'->'before' ?| ${touched} or ${auditLog.metadata}->'receipt'->'after' ?| ${touched})`,
        ),
      )
      .limit(1);
    if (
      later ||
      keys.some((key) => !sameValue(receiptValue(row, key), receipt.after[key]))
    )
      throw conflict("These settings changed since. Undo is unavailable.");
    await db
      .update(settings)
      .set(restoredColumns(row, keys, receipt.before))
      .where(eq(settings.id, row.id));
    // The response schema drops `receipt`; the event reads it from the raw result.
    return Object.assign(
      { id: params.receiptId, area: receipt.area, undoneAt: new Date() },
      {
        receipt: {
          area: receipt.area,
          before: receipt.after,
          after: receipt.before,
        },
      },
    );
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...undo,
);
