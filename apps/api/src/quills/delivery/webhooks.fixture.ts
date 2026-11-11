import { isNull } from "drizzle-orm";
import { webhooks } from "../../database/quills/schema/webhooks";
import { fixture, type ContractEnv } from "../framework/contract";

// Create and rotate encrypt the signing secret. A configured instance key wins.
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

/** A TEST-NET-3 literal: a public address that needs no DNS lookup. */
const target = "https://203.0.113.10/hooks";

/** One live webhook per workspace; earlier ones are retired so the per-workspace limit never blocks a check. */
async function side(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db, actor) => {
    await db
      .update(webhooks)
      .set({ deletedAt: new Date() })
      .where(isNull(webhooks.deletedAt));
    const [row] = await db
      .insert(webhooks)
      .values({
        createdById: actor.principalId,
        url: target,
        secret: "enc:contract",
        events: ["post.task_linked"],
      })
      .returning({ id: webhooks.id });
    return row!.id;
  });
}
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const one = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { webhookId: a }, body }),
    foreign: ({ b }: Ids) => ({ webhookId: b }),
  });

export const listQuillsWebhooks = fixture({ seed, valid: () => ({}) });
export const getQuillsWebhook = one();
export const createQuillsWebhook = fixture({
  seed,
  valid: () => ({ body: { url: target, events: ["post.task_linked"] } }),
});
export const updateQuillsWebhook = one({ status: "disabled" });
export const deleteQuillsWebhook = one();
export const rotateQuillsWebhookSecret = one();
