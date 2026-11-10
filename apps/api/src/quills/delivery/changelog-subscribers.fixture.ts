import { principal, user } from "../../database/quills/schema/auth";
import { fixture, type ContractEnv } from "../framework/contract";

/** A customer account and its principal. */
async function side(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db) => {
    const email = `${env.id("customer")}@example.test`;
    const [identity] = await db
      .insert(user)
      .values({ name: "Customer", email })
      .returning({ id: user.id });
    const [person] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        displayName: "Customer",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    return { principalId: person!.id, email };
  });
}
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const person = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { principalId: a.principalId }, body }),
    foreign: ({ b }: Ids) => ({ principalId: b.principalId }),
  });

export const getQuillsChangelogSubscriber = person();
export const setQuillsChangelogSubscriber = person({ subscribed: true });
export const importQuillsChangelogSubscribers = fixture({
  seed,
  valid: ({ a }: Ids) => ({ body: { emails: [a.email] } }),
});
