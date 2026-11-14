import { describe, expect, it } from "vite-plus/test";
import { statusProgress } from "./status-progress";

const statuses = [
  { id: "open", category: "active" },
  { id: "review", category: "active" },
  { id: "planned", category: "active" },
  { id: "progress", category: "active" },
  { id: "done", category: "complete" },
  { id: "closed", category: "closed" },
];

describe("statusProgress", () => {
  it("fills the open statuses in order", () => {
    expect(
      ["open", "review", "planned", "progress"].map((id) =>
        statusProgress(statuses, id),
      ),
    ).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("is full for complete and closed statuses and empty for an unknown one", () => {
    expect(statusProgress(statuses, "done")).toBe(1);
    expect(statusProgress(statuses, "closed")).toBe(1);
    expect(statusProgress(statuses, "gone")).toBe(0);
    expect(statusProgress(statuses, null)).toBe(0);
  });
});
