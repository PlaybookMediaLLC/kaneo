import { settings } from "../../database/quills/schema/auth";
import type { ContractEnv } from "../framework/contract";

/** Makes workspace A's portal private behind a domain that no response may name. */
export async function privatePortal(env: ContractEnv, domain: string) {
  await env.scoped(env.a, (db) =>
    db.update(settings).set({
      portalConfig: JSON.stringify({
        access: { visibility: "private", allowedDomains: [domain] },
      }),
    }),
  );
}
