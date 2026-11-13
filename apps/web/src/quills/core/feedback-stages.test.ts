import { describe, expect, it } from "vite-plus/test";
import { feedbackStages } from "./feedback-stages";
describe("feedbackStages", () => {
  it("names each stage after its first status and excludes unmapped statuses", () => {
    expect(
      feedbackStages([
        { stage: null, name: "New" },
        { stage: "planned", name: "Later", color: "blue" },
        { stage: "planned", name: "Planned", color: "teal" },
        { stage: "shipped", name: "Complete" },
      ]),
    ).toEqual([
      { value: "planned", label: "Later", color: "blue" },
      { value: "shipped", label: "Complete", color: null },
    ]);
  });
});
