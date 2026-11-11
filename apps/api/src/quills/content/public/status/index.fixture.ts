import { eq } from "drizzle-orm";
import type { PrincipalId, StatusComponentId } from "@kaneo/ids";
import { principal, user } from "../../../../database/quills/schema/auth";
import { statusSubscriptions } from "../../../../database/quills/schema/status";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../../../framework/contract";
import { statusSeed, type StatusIds } from "../seed.fixture";
import { mintStatusUnsubscribeToken } from "./subscriptions";

// Public reads: no customer owns the result, so `own` is empty on purpose.
const read = (
  valid: (ids: StatusIds) => ContractInput,
  foreign?: (ids: StatusIds) => Record<string, string>,
) =>
  fixture({
    seed: statusSeed,
    valid,
    foreign,
    hidden: (ids: StatusIds) => ids.hidden,
    own: () => [],
  });

export const getQuillsPublicStatusPage = read(() => ({}));
export const getQuillsPublicStatusIncident = read(
  ({ a }) => ({ params: { incidentId: a.incidentId } }),
  ({ b }) => ({ incidentId: b.incidentId }),
);
// The gated component is asked for and left out.
export const getQuillsPublicStatusUptime = read(({ a }) => ({
  query: { componentIds: `${a.componentId},${a.gatedComponentId}` },
}));
export const listQuillsPublicStatusHistory = read(() => ({}));
export const listQuillsPublicStatusFeed = read(() => ({}));

/** Sets customer A's subscription in A: active on one component, or opted out. */
async function customerA(env: ContractEnv, active: boolean) {
  const ids = await statusSeed(env);
  const customer = await env.portalCustomer(env.a, env.customerA);
  const principalId = customer.principalId as PrincipalId;
  await env.scoped(env.a, (db) =>
    db
      .insert(statusSubscriptions)
      .values({
        principalId,
        scope: "components",
        componentIds: [ids.a.componentId],
        source: "self_serve",
        unsubscribedAt: active ? null : new Date(),
      })
      .onConflictDoUpdate({
        target: [
          statusSubscriptions.workspaceId,
          statusSubscriptions.principalId,
        ],
        set: {
          scope: "components",
          componentIds: [ids.a.componentId],
          unsubscribedAt: active ? null : new Date(),
        },
      }),
  );
  return { ...ids, principalId };
}

/** Customer A's subscription row. */
const rowOf = (
  env: ContractEnv,
  { principalId }: { principalId: PrincipalId },
) =>
  env.scoped(env.a, (db) =>
    db
      .select({
        scope: statusSubscriptions.scope,
        componentIds: statusSubscriptions.componentIds,
        unsubscribedAt: statusSubscriptions.unsubscribedAt,
      })
      .from(statusSubscriptions)
      .where(eq(statusSubscriptions.principalId, principalId)),
  );

export const getQuillsMyStatusSubscription = fixture({
  seed: (env) => customerA(env, true),
  valid: () => ({}),
  // Only customer A subscribed to this component.
  own: ({ a }) => [a.componentId],
  hidden: (ids) => ids.hidden,
});

export const subscribeQuillsStatus = fixture({
  seed: (env) => customerA(env, false),
  valid: ({ a }) => ({
    body: { scope: "components", componentIds: [a.componentId] },
  }),
  hidden: (ids) => ids.hidden,
  own: () => [],
  probe: rowOf,
});

export const unsubscribeQuillsStatus = fixture({
  seed: (env) => customerA(env, true),
  valid: () => ({}),
  hidden: (ids) => ids.hidden,
  own: () => [],
  probe: rowOf,
});

export const unsubscribeQuillsStatusByToken = fixture({
  seed: async (env) => {
    const ids = await statusSeed(env);
    const token = await env.scoped(env.a, async (db) => {
      const label = env.id("subscriber");
      const [identity] = await db
        .insert(user)
        .values({ name: label, email: `${label}@example.test` })
        .returning({ id: user.id });
      const [person] = await db
        .insert(principal)
        .values({
          userId: identity!.id,
          role: "user",
          type: "user",
          displayName: label,
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      await db.insert(statusSubscriptions).values({
        principalId: person!.id,
        scope: "components",
        componentIds: [ids.a.componentId as StatusComponentId],
        source: "admin",
      });
      return mintStatusUnsubscribeToken(db, person!.id);
    });
    return { ...ids, token };
  },
  valid: ({ token }) => ({ body: { token } }),
  hidden: ({ token, hidden }) => [token, ...hidden],
});
