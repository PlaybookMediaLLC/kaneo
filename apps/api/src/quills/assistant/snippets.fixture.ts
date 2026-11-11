import { empty, fixture } from "../framework/contract";
import { on } from "./seed.fixture";

export const listQuillsSnippets = empty;
export const createQuillsSnippet = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { title: "Hours", content: "We answer within a day." },
  }),
});
export const updateQuillsSnippet = on(
  ["snippet"],
  (a) => ({
    params: { snippetId: a.snippetId },
    body: { content: "Five days." },
  }),
  (b) => ({ snippetId: b.snippetId }),
);
export const deleteQuillsSnippet = on(
  ["snippet"],
  (a) => ({ params: { snippetId: a.snippetId } }),
  (b) => ({ snippetId: b.snippetId }),
);
