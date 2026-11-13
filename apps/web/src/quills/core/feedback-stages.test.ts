import { describe, expect, it } from "vite-plus/test";
import { feedbackStages } from "./feedback-stages";
describe("feedbackStages", () => {
  it("keeps configured labels, excludes unmapped statuses and deduplicates stages", () => {
    expect(
      feedbackStages([
        { stage: null, name: "New" },
        { stage: "planned", name: "Later" },
        { stage: "planned", name: "Planned" },
      ]),
    ).toEqual([{ value: "planned", label: "Planned" }]);
  });
});
