import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import { principal, settings } from "../../../database/quills/schema/auth";
import { kvStore } from "../../../database/quills/schema/kv";
import { recordQuillsChange } from "../../events";
import { seedShowcaseEngagement } from "./engagement";
import { seedShowcaseFeedback } from "./feedback";
import { seedShowcaseHelp } from "./help";
import { seedShowcaseSegments } from "./segments";
import { seedShowcaseSupport } from "./support";
import { seedShowcaseTriage } from "./triage";
import { seedShowcaseUpdates } from "./updates";

type Counts = Record<string, string | number>;

/** The teammate app's data. It reads the customers that the portal stage created. */
async function seedShowcaseTeam(db: Database, actor: QuillsActor) {
  const customers = (
    await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          isNotNull(principal.userId),
          isNull(principal.testOwnerPrincipalId),
          eq(principal.type, "user"),
        ),
      )
      .orderBy(principal.displayName, principal.id)
  ).map((row) => row.id);
  if (customers.length < 60)
    throw new Error("Team showcase requires the portal showcase customers");
  const support = await seedShowcaseSupport(db, actor, customers);
  const segments = await seedShowcaseSegments(db, customers);
  return {
    ...support.counts,
    ...(await seedShowcaseTriage(db, actor, support.requests)),
    ...segments,
    ...(await seedShowcaseEngagement(
      db,
      actor,
      customers,
      segments.betaSegmentId,
    )),
  };
}

// Each stage has its own receipt, so a workspace seeded before a stage existed gets only that stage.
const stages: [
  string,
  (db: Database, actor: QuillsActor) => Promise<Counts>,
][] = [
  [
    "dev:portal-showcase:v1",
    async (db, actor) => ({
      ...(await seedShowcaseFeedback(db, actor)),
      ...(await seedShowcaseHelp(db, actor)),
      ...(await seedShowcaseUpdates(db, actor)),
    }),
  ],
  ["dev:team-showcase:v1", seedShowcaseTeam],
];

// Called only inside seedPortal's local, fixture-owned workspace transaction.
export async function seedPortalShowcase(db: Database, actor: QuillsActor) {
  if (
    actor.workspaceId !== "quills_portal_demo" ||
    actor.userId !== "quills_portal_demo_user"
  )
    throw new Error("Portal showcase requires the owned demo workspace");
  // Serialize repeated seed commands; the receipt commits atomically with the dataset.
  await db.select({ id: settings.id }).from(settings).for("update");
  for (const [key, seed] of stages) {
    const [seeded] = await db
      .select({ value: kvStore.value })
      .from(kvStore)
      .where(eq(kvStore.key, key));
    if (seeded) continue;
    const counts = await seed(db, actor);
    await recordQuillsChange(db, actor, {
      type: "workspace.imported",
      entityType: "workspace",
      entityId: actor.workspaceId,
      payload: {
        source: key,
        ...Object.fromEntries(
          Object.entries(counts).map(([name, value]) => [name, String(value)]),
        ),
      },
    });
    await db.insert(kvStore).values({
      workspaceKey: actor.workspaceId,
      key,
      value: counts,
      expiresAt: new Date("2100-01-01"),
    });
  }
}
