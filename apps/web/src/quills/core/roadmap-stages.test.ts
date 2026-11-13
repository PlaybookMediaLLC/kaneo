import { describe, expect, it } from "vite-plus/test";
import { roadmapStages } from "./roadmap-stages";

describe("roadmapStages", () => {
  it("keeps marked stages after open in workflow order", () => {
    expect(
      roadmapStages([
        { stage: "shipped", name: "Done", color: "green", showOnRoadmap: true },
        { stage: "open", name: "Open", showOnRoadmap: true },
        { stage: "planned", name: "Planned", showOnRoadmap: true },
        { stage: "in_progress", name: "Building", showOnRoadmap: false },
      ]).map((stage) => [stage.value, stage.label]),
    ).toEqual([
      ["planned", "Planned"],
      ["shipped", "Done"],
    ]);
  });

  it("shows every stage when no status is marked", () => {
    expect(
      roadmapStages([
        { stage: "in_progress", name: "Building" },
        { stage: "planned", name: "Planned" },
        { stage: null, name: "Closed" },
      ]).map((stage) => stage.value),
    ).toEqual(["planned", "in_progress"]);
  });
});
