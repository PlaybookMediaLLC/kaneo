import { empty, fixture } from "../framework/contract";
import { on } from "./seed.fixture";

export const listQuillsAssistantDocuments = empty;
export const uploadQuillsAssistantDocument = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      title: "Returns",
      fileName: "returns.md",
      mimeType: "text/markdown",
      content: "# Returns\nWithin 30 days.",
    },
  }),
});
export const deleteQuillsAssistantDocument = on(
  ["document"],
  (a) => ({ params: { documentId: a.documentId } }),
  (b) => ({ documentId: b.documentId }),
);
