import { settings } from "../../database/quills/schema/auth";
import type { ContractEnv } from "../framework/contract";

/** Turns on a workspace's portal (portals are opt-in) and keeps it public. */
export async function enablePortal(env: ContractEnv, workspaceId: string) {
  await env.scoped(workspaceId, (db) =>
    db
      .update(settings)
      .set({ portalConfig: JSON.stringify({ enabled: true }) }),
  );
}

/** Turns on workspace A's portal and makes it private behind a domain that no response may name. */
export async function privatePortal(env: ContractEnv, domain: string) {
  await env.scoped(env.a, (db) =>
    db.update(settings).set({
      portalConfig: JSON.stringify({
        enabled: true,
        access: { visibility: "private", allowedDomains: [domain] },
      }),
    }),
  );
}
