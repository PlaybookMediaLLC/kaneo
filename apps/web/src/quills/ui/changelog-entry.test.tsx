import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { ChangelogEntry } from "./changelog-entry";

const entry = {
  id: "changelog_test_1",
  title: "November release",
  content: "**Faster** boards",
  publishedAt: "2026-11-02T12:00:00.000Z",
  author: { name: "Morgan", avatarUrl: null },
  categories: [{ id: "category_test_1", name: "New feature" }],
  linkedPosts: [
    {
      id: "post_test_1",
      title: "Faster boards",
      voteCount: 7,
      stage: "shipped",
    },
  ],
  requesterCount: 5,
};

describe("ChangelogEntry", () => {
  it("shows the date, tags, notes, requests and author", () => {
    const view = renderComponent(
      <ChangelogEntry workspaceId="workspace_test_1" entry={entry} />,
    );
    expect(
      view.getByRole("link", { name: "November release" }),
    ).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/changelog/changelog_test_1",
    );
    expect(view.getByText("Nov 2, 2026")).toHaveAttribute(
      "datetime",
      entry.publishedAt,
    );
    expect(view.getByRole("list", { name: "Tags" })).toHaveTextContent(
      "New feature",
    );
    expect(view.getByText("Faster")).toBeInTheDocument();
    expect(
      view.getByRole("heading", { name: "The feedback behind this update" }),
    ).toBeInTheDocument();
    expect(view.getByRole("link", { name: /Faster boards/ })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_test_1",
    );
    expect(view.getByText("Requested by 5 people")).toBeInTheDocument();
    expect(view.getByText("Morgan")).toBeInTheDocument();
  });

  it("leaves the title to the entry page", () => {
    const view = renderComponent(
      <ChangelogEntry
        workspaceId="workspace_test_1"
        entry={{ ...entry, linkedPosts: [], author: null }}
        linkTitle={false}
      />,
    );
    expect(
      view.queryByRole("link", { name: "November release" }),
    ).not.toBeInTheDocument();
    expect(view.queryByText("Morgan")).not.toBeInTheDocument();
  });
});
