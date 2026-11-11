import { empty, fixture } from "../framework/contract";
import { on } from "./seed.fixture";

export const listQuillsWebSources = empty;
export const addQuillsWebSource = fixture({
  seed: async (env) => ({ url: `https://docs.example.test/${env.id("new")}` }),
  valid: ({ url }) => ({ body: { url } }),
});
export const setQuillsWebSourceEnabled = on(
  ["webSource"],
  (a) => ({ params: { webSourceId: a.webSourceId }, body: { enabled: false } }),
  (b) => ({ webSourceId: b.webSourceId }),
);
export const deleteQuillsWebSource = on(
  ["webSource"],
  (a) => ({ params: { webSourceId: a.webSourceId } }),
  (b) => ({ webSourceId: b.webSourceId }),
);
