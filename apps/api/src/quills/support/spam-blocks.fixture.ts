import { spamBlocks } from "../../database/quills/schema/spam-blocks";
import { fixture, type ContractEnv } from "../framework/contract";

async function seedBlocks(env: ContractEnv) {
  const [a] = await env.scoped(env.a, (db) =>
    db
      .insert(spamBlocks)
      .values({
        kind: "email_domain",
        value: `spam-${env.id("a")}.example`,
        reason: "Fixture spam domain",
      })
      .returning({ id: spamBlocks.id }),
  );
  const [b] = await env.scoped(env.b, (db) =>
    db
      .insert(spamBlocks)
      .values({
        kind: "email_domain",
        value: `spam-${env.id("b")}.example`,
        reason: "Foreign fixture spam domain",
      })
      .returning({ id: spamBlocks.id }),
  );
  return { a: a!.id, b: b!.id };
}

export const listQuillsSpamBlocks = fixture({
  seed: seedBlocks,
  valid: () => ({}),
});

export const createQuillsSpamBlock = fixture({
  seed: seedBlocks,
  valid: () => ({
    body: {
      kind: "ip_cidr",
      value: "203.0.113.0/24",
      reason: "Bot flood",
      expiresInDays: 7,
    },
  }),
});

export const deleteQuillsSpamBlock = fixture({
  seed: seedBlocks,
  valid: (ids) => ({ params: { blockId: ids.a } }),
  foreign: (ids) => ({ blockId: ids.b }),
});
