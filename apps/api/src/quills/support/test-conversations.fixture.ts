import { fixture, type ContractEnv } from "../framework/contract";
import {
  conversation,
  customer,
  testCustomer,
} from "./conversation-seed.fixture";

/** A real and a test conversation in one workspace. */
const testSide = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const email = () => `${env.id("customer")}@example.test`;
    const real = await customer(db, email());
    const tester = await testCustomer(db, actor.principalId, email());
    return {
      realId: (await conversation(db, actor.principalId, real)).conversationId,
      testId: (await conversation(db, actor.principalId, tester))
        .conversationId,
      testerId: tester,
    };
  });

export const deleteQuillsTestConversations = fixture({
  seed: async (env: ContractEnv) => ({
    a: await testSide(env, env.a),
    b: await testSide(env, env.b),
  }),
  valid: () => ({}),
});
