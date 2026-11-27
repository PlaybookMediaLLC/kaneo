import { eq } from "drizzle-orm";
import db from "../../database";
import { workspaceBillingTable } from "../../database/schema";
import type { DbOrTx } from "../../project-access/db-or-tx";
import { isBillingEnabled } from "../config";
import { updateSubscriptionSeats } from "../creem-client";
import { countWorkspaceSeats } from "./billable-seats";

export async function syncWorkspaceSeats(
  workspaceId: string,
  database: DbOrTx = db,
) {
  if (!isBillingEnabled()) {
    return;
  }

  const [billing] = await database
    .select()
    .from(workspaceBillingTable)
    .where(eq(workspaceBillingTable.workspaceId, workspaceId));

  if (
    !billing?.creemSubscriptionId ||
    !billing.creemProductId ||
    billing.plan !== "team" ||
    (billing.status !== "active" && billing.status !== "trialing")
  ) {
    return;
  }

  const { billableSeats } = await countWorkspaceSeats(workspaceId, database);
  const seats = Math.max(1, billableSeats);
  if (seats === billing.seats) {
    return;
  }

  await updateSubscriptionSeats({
    subscriptionId: billing.creemSubscriptionId,
    productId: billing.creemProductId,
    units: seats,
  });

  await database
    .update(workspaceBillingTable)
    .set({ seats })
    .where(eq(workspaceBillingTable.workspaceId, workspaceId));
}
