import { eq } from "drizzle-orm";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { statusSubscriptions } from "../../database/quills/schema/status";
import { fixture, type ContractEnv } from "../framework/contract";
import { customerPost, enablePortal } from "./customer-seed.fixture";

/** The portal on in A, a visible post in A and B, and customer A's profile in A. */
async function posts(env: ContractEnv) {
  await enablePortal(env, env.a);
  const customer = await env.portalCustomer(env.a, env.customerA);
  return {
    a: await customerPost(env, env.a),
    b: await customerPost(env, env.b),
    principalId: customer.principalId as PrincipalId,
  };
}
type Posts = Awaited<ReturnType<typeof posts>>;

/** Customer A's rows in one subscription table; another caller must not change them. */
const rowsOf =
  (
    table:
      | typeof postSubscriptions
      | typeof changelogSubscriptions
      | typeof statusSubscriptions,
  ) =>
  (env: ContractEnv, ids: { principalId: PrincipalId }) =>
    env.scoped(env.a, async (db) =>
      (
        await db
          .select()
          .from(table)
          .where(eq(table.principalId, ids.principalId))
      ).map((row) => ({ ...row, updatedAt: undefined })),
    );

const postFixture = (
  body?: object,
  subscribed = false,
): ReturnType<typeof fixture<Posts>> =>
  fixture({
    seed: async (env) => {
      const ids = await posts(env);
      if (subscribed)
        await env.scoped(env.a, (db) =>
          db.insert(postSubscriptions).values({
            postId: ids.a.postId as PostId,
            principalId: ids.principalId,
            reason: "manual",
          }),
        );
      return ids;
    },
    valid: ({ a }) => ({ params: { postId: a.postId }, body }),
    foreign: ({ b }) => ({ postId: b.postId }),
    own: () => [],
    probe: rowsOf(postSubscriptions),
  });

export const getQuillsMyPostSubscription = postFixture();
export const setQuillsMyPostSubscription = postFixture({ level: "all" });
export const deleteQuillsMyPostSubscription = postFixture(undefined, true);

/** The portal on in A and customer A's profile; with `subscribe`, a live subscription in `table`. */
const selfServe = (
  table: typeof changelogSubscriptions | typeof statusSubscriptions,
  body?: object,
  subscribe = false,
) =>
  fixture({
    seed: async (env) => {
      await enablePortal(env, env.a);
      const { principalId } = await env.portalCustomer(env.a, env.customerA);
      const id = principalId as PrincipalId;
      // A fresh state per request: the previous check may have left a row.
      await env.scoped(env.a, async (db) => {
        await db.delete(table).where(eq(table.principalId, id));
        if (subscribe)
          await db
            .insert(table)
            .values({ principalId: id, source: "self_serve" });
      });
      return { principalId: id };
    },
    valid: () => ({ body }),
    own: () => [],
    probe: rowsOf(table),
  });

export const getQuillsMyChangelogSubscription = selfServe(
  changelogSubscriptions,
);
export const subscribeQuillsMyChangelog = selfServe(changelogSubscriptions);
export const unsubscribeQuillsMyChangelog = selfServe(
  changelogSubscriptions,
  undefined,
  true,
);
export const getQuillsMyStatusSubscription = selfServe(statusSubscriptions);
export const subscribeQuillsMyStatus = selfServe(statusSubscriptions, {
  scope: "page",
});
export const unsubscribeQuillsMyStatus = selfServe(
  statusSubscriptions,
  undefined,
  true,
);
