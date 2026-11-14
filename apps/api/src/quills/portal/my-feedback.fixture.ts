import { eq } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { notificationPreferences } from "../../database/quills/schema/notifications";
import { fixture, type ContractEnv } from "../framework/contract";
import { enablePortal } from "./customer-seed.fixture";
import { probe, scene, type Scene } from "./feedback/seed.fixture";

export const listQuillsPortalMyFeedback = fixture<Scene>({
  seed: (env) => scene(env, "portal"),
  valid: () => ({ query: { filter: "all" } }),
  hidden: (s) => [...s.a.hidden, ...s.b.hidden, s.b.postTitle, s.b.postId],
  own: (s) => s.a.own,
  probe,
});

/** The portal on in A and customer A's profile, with the weekly digest turned off. */
async function digestOff(env: ContractEnv) {
  await enablePortal(env, env.a);
  const ids = await env.portalCustomer(env.a, env.customerA);
  await env.scoped(env.a, (db) =>
    db
      .insert(notificationPreferences)
      .values({
        principalId: ids.principalId as PrincipalId,
        matrix: { weekly_digest: { email: false } },
      })
      .onConflictDoNothing(),
  );
  return ids;
}
const preferenceProbe = (env: ContractEnv, ids: { principalId: string }) =>
  env.scoped(env.a, (db) =>
    db
      .select({ matrix: notificationPreferences.matrix })
      .from(notificationPreferences)
      .where(
        eq(notificationPreferences.principalId, ids.principalId as PrincipalId),
      ),
  );

export const getQuillsMyWeeklyDigestPreference = fixture({
  seed: digestOff,
  valid: () => ({}),
  own: () => [],
});
export const setQuillsMyWeeklyDigestPreference = fixture({
  seed: digestOff,
  valid: () => ({ body: { weeklyDigest: true } }),
  probe: preferenceProbe,
});
