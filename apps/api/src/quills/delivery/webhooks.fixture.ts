import { isNull } from "drizzle-orm";
import {
  webhookDeliveries,
  webhooks,
} from "../../database/quills/schema/webhooks";
import { empty, fixture, type ContractEnv } from "../framework/contract";

// Create and rotate encrypt the signing secret. A configured instance key wins.
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

/** A TEST-NET-3 literal: a public address that needs no DNS lookup. */
const target = "https://203.0.113.10/hooks";

/** One live webhook and one delivery row per workspace. */
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
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: row!.id,
        eventId: "evt_contract_1",
        eventType: "post.task_linked",
        attempt: 1,
        status: "failed",
        httpStatus: 500,
        durationMs: 120,
        error: "HTTP 500",
      })
      .returning({ id: webhookDeliveries.id });
    return { webhookId: row!.id, deliveryId: delivery!.id };
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
    valid: ({ a }: Ids) => ({ params: { webhookId: a.webhookId }, body }),
    foreign: ({ b }: Ids) => ({ webhookId: b.webhookId }),
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
export const listQuillsWebhookDeliveries = one();
export const testQuillsWebhook = one();
export const replayQuillsWebhookDelivery = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { webhookId: a.webhookId, deliveryId: a.deliveryId },
  }),
  foreign: ({ b }: Ids) => ({
    webhookId: b.webhookId,
    deliveryId: b.deliveryId,
  }),
});
export const replayQuillsFailedWebhookDeliveries = one();
export const listQuillsEvents = empty;
