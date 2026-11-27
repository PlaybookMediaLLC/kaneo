import { isFreeSeatRole } from "@kaneo/permissions";
import { eq } from "drizzle-orm";
import db from "../../database";
import { workspaceUserTable } from "../../database/schema";
import type { DbOrTx } from "../../project-access/db-or-tx";
import { splitRoles } from "../../utils/split-roles";

export interface WorkspaceSeatCounts {
  billableSeats: number;
  freeSeats: number;
  totalMembers: number;
}

/**
 * Counts paid vs free workspace seats (#328).
 * Viewers and collaborators never count as paid seats on any plan.
 * A member holding multiple comma-separated roles counts as billable only if at least one role is billable.
 */
export async function countWorkspaceSeats(
  workspaceId: string,
  database: DbOrTx = db,
): Promise<WorkspaceSeatCounts> {
  const members = await database
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));

  let billableSeats = 0;
  let freeSeats = 0;
  for (const member of members) {
    const roles = splitRoles(member.role);
    const isBillable = roles.some((role) => !isFreeSeatRole(role));
    if (isBillable) billableSeats += 1;
    else freeSeats += 1;
  }

  return {
    billableSeats,
    freeSeats,
    totalMembers: members.length,
  };
}
