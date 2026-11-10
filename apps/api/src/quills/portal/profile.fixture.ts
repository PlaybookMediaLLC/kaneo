import { eq } from "drizzle-orm";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { fixture, type ContractEnv } from "../framework/contract";
import { enablePortal } from "./seed.fixture";

/** Customer A's portal profile in A, renamed to a value only customer A may read. */
async function customerA(env: ContractEnv) {
  await enablePortal(env, env.a);
  const ids = await env.portalCustomer(env.a, env.customerA);
  const name = env.id("own");
  await env.scoped(env.a, (db) =>
    db
      .update(customer)
      .set({ name })
      .where(
        eq(customer.id, ids.customerId as typeof customer.$inferSelect.id),
      ),
  );
  return { ...ids, name };
}

/** Customer A's link and name in A. */
const linkOf = (env: ContractEnv) =>
  env.scoped(env.a, (db) =>
    db
      .select({ id: customer.id, name: customer.name })
      .from(customer)
      .where(eq(customer.kaneoUserId, env.customerA)),
  );

export const getQuillsCustomerProfile = fixture({
  seed: customerA,
  valid: () => ({}),
  own: (ids) => [ids.name, ids.principalId],
});

export const updateQuillsCustomerProfile = fixture({
  seed: customerA,
  valid: () => ({ body: { name: "Renamed customer" } }),
  own: (ids) => [ids.name, ids.principalId],
  probe: linkOf,
});

export const unlinkQuillsCustomerProfile = fixture({
  seed: customerA,
  valid: () => ({}),
  own: (ids) => [ids.principalId],
  probe: linkOf,
  // The link is gone after the request; the audit row names the principal that unlinked it.
  actor: async (_env, ids) => ids.principalId,
});

async function avatarCustomer(env: ContractEnv, workspaceId: string) {
  const label = env.id("avatar");
  const url = `https://img.example/${label}.png`;
  const id = await env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(customer)
      .values({ name: label, image: url })
      .returning({ id: customer.id });
    await db.insert(principal).values({
      userId: row!.id,
      role: "user",
      type: "user",
      displayName: label,
      createdAt: new Date(),
    });
    return row!.id;
  });
  return { id, url };
}

export const getQuillsCustomerAvatar = fixture({
  seed: async (env) => ({
    a: await enablePortal(env, env.a).then(() => avatarCustomer(env, env.a)),
    b: await avatarCustomer(env, env.b),
  }),
  valid: (ids) => ({ params: { customerId: ids.a.id } }),
  foreign: (ids) => ({ customerId: ids.b.id }),
  hidden: (ids) => [ids.b.url],
});
