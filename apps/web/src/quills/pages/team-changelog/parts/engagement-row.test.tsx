import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { EngagementRow } from "./engagement-row";

const item = {
  title: "November release",
  publishedAt: "2026-11-01T12:00:00.000Z",
  readCount: 3,
  reactions: [
    { emoji: "🎉", count: 2 },
    { emoji: "🚀", count: 1 },
  ],
};

describe("EngagementRow", () => {
  it("shows readers and reactions of an update", () => {
    const view = renderComponent(
      <ul>
        <EngagementRow item={item} />
      </ul>,
    );
    expect(view.getByText("November release")).toBeInTheDocument();
    expect(view.getByText("3 readers")).toBeInTheDocument();
    expect(view.getByText(/🎉 2, 🚀 1/)).toBeInTheDocument();
  });

  it("says when an update has no reactions", () => {
    const view = renderComponent(
      <ul>
        <EngagementRow item={{ ...item, readCount: 1, reactions: [] }} />
      </ul>,
    );
    expect(view.getByText("1 reader")).toBeInTheDocument();
    expect(view.getByText(/No reactions/)).toBeInTheDocument();
  });
});
