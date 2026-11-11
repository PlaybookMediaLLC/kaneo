import { fixture, type ContractEnv } from "../framework/contract";
import { customer, customers } from "./seed.fixture";

type Pair = Awaited<ReturnType<typeof customers>>;
const onePerson = (input: (ids: Pair) => { body?: unknown }) =>
  fixture({
    seed: customers,
    valid: (ids: Pair) => ({ params: { principalId: ids.a }, ...input(ids) }),
    foreign: (ids: Pair) => ({ principalId: ids.b }),
  });
const freshEmail = async (env: ContractEnv) => ({
  email: `${env.id("new")}@example.test`,
});

export const listQuillsUsers = fixture({
  seed: customers,
  valid: () => ({}),
});

export const findQuillsUsersByEmail = fixture({
  seed: async (env) => {
    const email = `${env.id("find")}@example.test`;
    await customer(env, env.a, { email });
    return { email };
  },
  valid: ({ email }) => ({ query: { email } }),
});

export const createQuillsUser = fixture({
  seed: freshEmail,
  valid: ({ email }) => ({ body: { name: "New Customer", email } }),
});

export const identifyQuillsUser = fixture({
  seed: freshEmail,
  valid: ({ email }) => ({
    body: { email, name: "Identified" },
  }),
});

export const getQuillsUser = onePerson(() => ({}));
export const updateQuillsUser = onePerson(() => ({
  body: { name: "Renamed Customer" },
}));
export const deleteQuillsUser = onePerson(() => ({}));
export const listQuillsUserDuplicates = onePerson(() => ({}));
