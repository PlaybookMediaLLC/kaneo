import { asc } from "drizzle-orm";
import { assistantGuidanceRules } from "../../database/quills/schema/assistant-guidance";
import { empty, fixture } from "../framework/contract";
import { on, side } from "./seed.fixture";

const onRule = (body?: object) =>
  on(
    ["rule"],
    (a) => ({ params: { ruleId: a.ruleId }, ...(body && { body }) }),
    (b) => ({ ruleId: b.ruleId }),
  );

export const listQuillsGuidanceRules = empty;
export const getQuillsGuidanceRuleStats = empty;
export const createQuillsGuidanceRule = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { name: "Tone", instruction: "Be kind.", agent: "copilot" },
  }),
});
export const updateQuillsGuidanceRule = onRule({ enabled: false });
export const deleteQuillsGuidanceRule = onRule();
export const reorderQuillsGuidanceRules = fixture({
  // Every rule of A, reversed.
  seed: async (env) => {
    await side(env, env.a, ["rule"]);
    const rows = await env.scoped(env.a, (db) =>
      db
        .select({ id: assistantGuidanceRules.id })
        .from(assistantGuidanceRules)
        .orderBy(asc(assistantGuidanceRules.priority)),
    );
    return { ruleIds: rows.map((row) => row.id).reverse() };
  },
  valid: ({ ruleIds }) => ({ body: { ruleIds } }),
});
