import { kbSearchSynonyms } from "../../../database/quills/schema/kb";
import { fixture } from "../../framework/contract";

export const getQuillsHelpCenterSearchInsights = fixture({
  seed: async () => ({}),
  valid: () => ({ query: { days: "30" } }),
});

export const listQuillsHelpCenterSearchSynonyms = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});

export const createQuillsHelpCenterSearchSynonym = fixture({
  seed: async (env) => ({ term: env.id("syn") }),
  valid: (s) => ({
    body: { term: s.term, synonyms: ["invoice", "receipt"] },
  }),
});

export const deleteQuillsHelpCenterSearchSynonym = fixture({
  seed: async (env) => {
    const [a] = await env.scoped(env.a, (db) =>
      db
        .insert(kbSearchSynonyms)
        .values({ term: env.id("syna"), synonyms: ["billing"] })
        .returning({ id: kbSearchSynonyms.id }),
    );
    const [b] = await env.scoped(env.b, (db) =>
      db
        .insert(kbSearchSynonyms)
        .values({ term: env.id("synb"), synonyms: ["billing"] })
        .returning({ id: kbSearchSynonyms.id }),
    );
    return { aId: a!.id, bId: b!.id };
  },
  valid: (s) => ({ params: { synonymId: s.aId } }),
  foreign: (s) => ({ synonymId: s.bId }),
});
