import { eq } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { settings } from "../../database/quills/schema/auth";
import { recordQuillsChange } from "../events";
import { fixture, type ContractEnv } from "../framework/contract";
import { parseJson } from "./area";

/**
 * A labs write with its receipt, as the update route records it: the status page flag flips, and
 * the receipt holds its value before and after. Each seed is the newest change of that flag.
 */
const labsReceiptIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const [row] = await db.select().from(settings).limit(1).for("update");
    const flags = parseJson(row!.featureFlags);
    const key = "featureFlags.statusPage";
    const after = flags.statusPage !== true;
    await db
      .update(settings)
      .set({ featureFlags: JSON.stringify({ ...flags, statusPage: after }) })
      .where(eq(settings.id, row!.id));
    const receiptId = createId("audit_log");
    await recordQuillsChange(db, actor, {
      type: "settings.labs_updated",
      entityType: "settings",
      entityId: workspaceId,
      receiptId,
      receipt: {
        area: "labs",
        before:
          typeof flags.statusPage === "boolean"
            ? { [key]: flags.statusPage }
            : {},
        after: { [key]: after },
      },
    });
    return receiptId;
  });

export const createQuillsSettingsReceiptsUndo = fixture({
  seed: async (env: ContractEnv) => ({
    a: await labsReceiptIn(env, env.a),
    b: await labsReceiptIn(env, env.b),
  }),
  valid: (s) => ({ params: { receiptId: s.a } }),
  foreign: (s) => ({ receiptId: s.b }),
});
