import { companyAttributeDefinitions } from "../../database/quills/schema/company-attributes";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { empty, fixture, type ContractEnv } from "../framework/contract";

function attributeFixtures(table: typeof userAttributeDefinitions) {
  const definition = (env: ContractEnv, workspaceId: string) =>
    env.scoped(workspaceId, async (db) => {
      const [row] = await db
        .insert(table)
        .values({ key: env.id("attr"), label: "Contract", type: "string" })
        .returning({ id: table.id });
      return row!.id;
    });
  const seed = async (env: ContractEnv) => ({
    a: await definition(env, env.a),
    b: await definition(env, env.b),
  });
  const byId = (body?: unknown) =>
    fixture({
      seed,
      valid: (ids) => ({ params: { attributeId: ids.a }, body }),
      foreign: (ids) => ({ attributeId: ids.b }),
    });
  return {
    list: empty,
    create: fixture({
      seed: async (env) => ({ key: env.id("attr") }),
      valid: ({ key }) => ({ body: { key, label: "Plan", type: "string" } }),
    }),
    update: byId({ label: "Renamed" }),
    remove: byId(),
  };
}

const user = attributeFixtures(userAttributeDefinitions);
// Both tables have the same columns; only the ID prefix differs.
const company = attributeFixtures(
  companyAttributeDefinitions as unknown as typeof userAttributeDefinitions,
);

export const listQuillsUserAttributes = user.list;
export const createQuillsUserAttribute = user.create;
export const updateQuillsUserAttribute = user.update;
export const deleteQuillsUserAttribute = user.remove;
export const listQuillsCompanyAttributes = company.list;
export const createQuillsCompanyAttribute = company.create;
export const updateQuillsCompanyAttribute = company.update;
export const deleteQuillsCompanyAttribute = company.remove;
