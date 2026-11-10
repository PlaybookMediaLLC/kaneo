import { fixture } from "../../framework/contract";
import { all, by, seed, type Ids } from "./seed.fixture";

export const listQuillsStatusTemplates = all;
export const createQuillsStatusTemplate = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      name: "Degraded",
      title: "Degraded performance",
      body: "Some requests are slow",
      componentIds: [a.componentId],
    },
  }),
});
export const updateQuillsStatusTemplate = by("templateId", undefined, {
  impact: "major",
});
export const deleteQuillsStatusTemplate = by("templateId");
