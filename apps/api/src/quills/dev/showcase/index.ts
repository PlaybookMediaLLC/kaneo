import { eq } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { settings } from "../../../database/quills/schema/auth";
import { kvStore } from "../../../database/quills/schema/kv";
import { recordQuillsChange } from "../../events";
import { seedShowcaseFeedback } from "./feedback";
import { seedShowcaseHelp } from "./help";
import { seedShowcaseUpdates } from "./updates";

const KEY = "dev:portal-showcase:v1";

// Called only inside seedPortal's local, fixture-owned workspace transaction.
export async function seedPortalShowcase(db: Database, actor: QuillsActor) {
  if (
    actor.workspaceId !== "quills_portal_demo" ||
    actor.userId !== "quills_portal_demo_user"
  )
    throw new Error("Portal showcase requires the owned demo workspace");
  // Serialize repeated seed commands; the receipt commits atomically with the dataset.
  await db.select({ id: settings.id }).from(settings).for("update");
  const [seeded] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(eq(kvStore.key, KEY));
  if (seeded) return;
  const counts = {
    ...(await seedShowcaseFeedback(db, actor)),
    ...(await seedShowcaseHelp(db, actor)),
    ...(await seedShowcaseUpdates(db, actor)),
  };
  await recordQuillsChange(db, actor, {
    type: "workspace.imported",
    entityType: "workspace",
    entityId: actor.workspaceId,
    payload: {
      source: "local-portal-showcase",
      ...Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [key, String(value)]),
      ),
    },
  });
  await db.insert(kvStore).values({
    workspaceKey: actor.workspaceId,
    key: KEY,
    value: counts,
    expiresAt: new Date("2100-01-01"),
  });
}
