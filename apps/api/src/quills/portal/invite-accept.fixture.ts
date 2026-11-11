import { eq } from "drizzle-orm";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { fixture } from "../framework/contract";
import {
  accountEmail,
  enablePortal,
  pendingInvite,
  verifyEmail,
} from "./customer-seed.fixture";

// Customer A's verified address is invited in A; workspace B has its own invite.
export const acceptQuillsPortalInvite = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    await verifyEmail(env, env.customerA);
    return {
      a: await pendingInvite(env, env.a, accountEmail(env.customerA)),
      b: await pendingInvite(env, env.b, accountEmail(env.customerA)),
    };
  },
  valid: ({ a }) => ({
    params: { inviteId: a.inviteId },
    body: { token: a.token },
  }),
  foreign: ({ b }) => ({ inviteId: b.inviteId }),
  own: () => [],
  // Customer B and a teammate hold the token but not the address: the invite stays pending.
  probe: (env, { a }) =>
    env.scoped(env.a, (db) =>
      db
        .select({
          status: portalInvites.status,
          tokens: portalInvites.tokenHashes,
        })
        .from(portalInvites)
        .where(eq(portalInvites.id, a.inviteId)),
    ),
});
