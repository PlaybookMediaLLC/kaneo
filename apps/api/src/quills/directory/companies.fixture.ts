import { fixture, type ContractEnv } from "../framework/contract";
import { company, customer } from "./seed.fixture";

const side = async (env: ContractEnv, workspaceId: string) => {
  const companyId = await company(env, workspaceId);
  return {
    companyId,
    principalId: await customer(env, workspaceId, { companyId }),
  };
};
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;

const byCompany = (body?: unknown) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { companyId: a.companyId }, body }),
    foreign: ({ b }: Ids) => ({ companyId: b.companyId }),
  });
const byPerson = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { principalId: a.principalId } }),
  foreign: ({ b }: Ids) => ({ principalId: b.principalId }),
});

export const listQuillsCompanies = fixture({ seed, valid: () => ({}) });
export const getQuillsCompany = byCompany();
export const createQuillsCompany = fixture({
  seed: async (env) => ({ name: env.id("new-company") }),
  valid: ({ name }) => ({ body: { name, plan: "pro" } }),
});
export const updateQuillsCompany = byCompany({ plan: "enterprise" });
export const deleteQuillsCompany = byCompany();
export const listQuillsCompanyMembers = byCompany();
export const getQuillsUserCompany = byPerson;
export const setQuillsUserCompany = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { principalId: a.principalId },
    body: { companyId: a.companyId },
  }),
  foreign: ({ b }: Ids) => ({
    principalId: b.principalId,
    companyId: b.companyId,
  }),
});
export const removeQuillsUserCompany = byPerson;
