import { createHmac, randomUUID } from "node:crypto";
import { createId } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import { integrations } from "../../database/quills/schema/integrations";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { encryptSecret } from "../../notification-preferences/secrets";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../framework/contract";
import { customer } from "../support/conversation-seed.fixture";
import "./seed.fixture";

/** A Segment connection, a `plan` attribute and one customer whose email Segment identifies. */
async function segment(env: ContractEnv, workspaceId: string) {
  const secret = `segment-secret-${workspaceId}-${randomUUID()}`;
  const email = `${randomUUID()}@identify.test`;
  return env.scoped(workspaceId, async (db, actor) => {
    await db
      .delete(integrations)
      .where(eq(integrations.integrationType, "segment"));
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: "segment",
        status: "active",
        secrets: encryptSecret(JSON.stringify({ incomingSecret: secret }))!,
        config: { workspaceName: "Segment", account: null },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(),
      })
      .returning({ id: integrations.id });
    await db
      .insert(userAttributeDefinitions)
      .values({ key: "plan", label: "Plan", type: "string" })
      .onConflictDoNothing();
    await customer(db, email);
    return { integrationId: row!.id, secret, email };
  });
}
type Seeded = Awaited<ReturnType<typeof segment>>;
type Ids = { a: Seeded; b: Seeded };

const identifyCall = (
  target: Seeded,
  secret = target.secret,
  options: { integrationId?: string; raw?: string } = {},
): ContractInput => {
  const raw =
    options.raw ??
    JSON.stringify({
      type: "identify",
      userId: "segment-user-1",
      timestamp: new Date().toISOString(),
      traits: { email: target.email, plan: `pro-${randomUUID()}` },
    });
  return {
    params: {
      type: "segment",
      integrationId: options.integrationId ?? target.integrationId,
    },
    raw,
    headers: {
      "x-signature": createHmac("sha1", secret).update(raw).digest("base64"),
    },
  };
};

export const receiveQuillsIdentify = fixture({
  seed: async (env: ContractEnv) => ({
    a: await segment(env, env.a),
    b: await segment(env, env.b),
  }),
  valid: ({ a }: Ids) => identifyCall(a),
  forged: ({ a, b }: Ids): ContractInput[] => {
    const good = identifyCall(a) as ContractInput & { raw: string };
    return [
      { ...good, headers: { "x-signature": "AAAA" } },
      { ...good, headers: {} },
      { ...good, raw: good.raw.replace("pro-", "free-") },
      identifyCall(a, a.secret, { integrationId: createId("integration") }),
      identifyCall(a, b.secret),
    ];
  },
  crossed: ({ a, b }: Ids) => [identifyCall(a, b.secret), identifyCall(b)],
  invalid: ({ a }: Ids): ContractInput[] =>
    ['{"type":5}', "[", '{"type":"identify","traits":[1]}'].map((raw) =>
      identifyCall(a, a.secret, { raw }),
    ),
  hidden: ({ a, b }: Ids) => [a.secret, b.secret],
});
