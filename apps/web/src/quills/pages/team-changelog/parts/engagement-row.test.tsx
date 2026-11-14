import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { EngagementRow } from "./engagement-row";

const item = {
  id: "changelog_test_1",
  title: "November release",
  publishedAt: "2026-11-01T12:00:00.000Z",
  readCount: 3,
  reactions: [
    { emoji: "🎉", count: 2 },
    { emoji: "🚀", count: 1 },
  ],
};
const href = "/portal/workspace_test_1/changelog/changelog_test_1";

describe("EngagementRow", () => {
  it("shows readers and reactions of an update, and opens it", () => {
    const onOpen = vi.fn();
    const view = renderComponent(
      <EngagementRow item={item} href={href} onOpen={onOpen} />,
    );
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("href", href);
    for (const text of ["November release", "3 readers", "🎉 2", "🚀 1"])
      expect(link).toHaveTextContent(text);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("says when an update has no reactions", () => {
    const view = renderComponent(
      <EngagementRow
        item={{ ...item, readCount: 1, reactions: [] }}
        href={href}
        onOpen={() => undefined}
      />,
    );
    expect(view.getByRole("link")).toHaveTextContent("1 reader · No reactions");
  });
});
