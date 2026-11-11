import { empty, fixture } from "../framework/contract";
import { on } from "./seed.fixture";

export const listQuillsSkills = empty;
export const createQuillsSkill = fixture({
  seed: async (env) => ({ name: env.id("skill") }),
  valid: ({ name }) => ({
    body: {
      name,
      whenToUse: "A billing question",
      instructions: "Ask for the invoice.",
    },
  }),
});
export const updateQuillsSkill = on(
  ["skill"],
  (a) => ({ params: { skillId: a.skillId }, body: { enabled: false } }),
  (b) => ({ skillId: b.skillId }),
);
export const deleteQuillsSkill = on(
  ["skill"],
  (a) => ({ params: { skillId: a.skillId } }),
  (b) => ({ skillId: b.skillId }),
);
