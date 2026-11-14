import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { WeeklyTrend } from "./weekly-trend";

describe("WeeklyTrend", () => {
  it("shows the new posts and votes of each week in a table", () => {
    const view = renderComponent(
      <WeeklyTrend
        weeks={[
          { week: "2026-11-02", posts: 1, votes: 0 },
          { week: "2026-11-09", posts: 4, votes: 6 },
        ]}
      />,
    );
    expect(
      view.getByRole("table", { name: "Weekly trend" }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("columnheader", { name: "New votes" }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("row", { name: "2026-11-09 4 6" }),
    ).toBeInTheDocument();
  });
});
