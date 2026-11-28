import { and, eq, isNull } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import db from "../../database";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import {
  principal,
  user as customerIdentity,
} from "../../database/quills/schema/auth";
import { recordQuillsChange } from "../../quills/events";
import { eraseCustomerInTx } from "../../quills/privacy/erase-customer";

/**
 * Called from account self-deletion (`delete-account-data.ts`) so deleting an account
 * also erases any linked Quills customer_identity profiles across workspaces.
 */
export async function eraseKaneoUserCustomerIdentities(
  accountUserId: string,
): Promise<number> {
  const linked = await db
    .select({
      workspaceId: customerIdentity.workspaceId,
      principalId: principal.id,
    })
    .from(customerIdentity)
    .innerJoin(
      principal,
      and(
        eq(principal.workspaceId, customerIdentity.workspaceId),
        eq(principal.userId, customerIdentity.id),
      ),
    )
    .where(
      and(
        eq(customerIdentity.kaneoUserId, accountUserId),
        isNull(principal.kaneoUserId),
      ),
    );

  let erased = 0;
  for (const row of linked) {
    await withQuillsSystemWorkspace(
      row.workspaceId,
      async (tx) => {
        const result = await eraseCustomerInTx(
          tx,
          row.principalId as PrincipalId,
          { mode: "anonymize", actor: null },
        );
        await recordQuillsChange(tx, null, {
          type: "privacy.customer_erased",
          entityType: "privacy_request",
          entityId: result.requestId,
          payload: {
            mode: result.mode,
            conversations: String(result.summary.conversations ?? 0),
            messages: String(result.summary.messages ?? 0),
            files: String(result.summary.files ?? 0),
          },
        });
      },
      { allowArchived: true },
    );
    erased += 1;
  }
  return erased;
}
