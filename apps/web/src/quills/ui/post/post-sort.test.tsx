import { describe, expect, it, vi } from "vite-plus/test";
import { choose } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostSort } from "./post-sort";

describe("PostSort", () => {
  it("labels the post list and reports a sort change", async () => {
    const onSortChange = vi.fn();
    const view = renderComponent(
      <PostSort sort="votes" onSortChange={onSortChange} />,
    );
    expect(view.getByRole("heading", { name: "Posts" })).toBeInTheDocument();
    await choose("Sort", "Newest");
    expect(onSortChange).toHaveBeenCalledWith("newest");
  });

  it("offers the shuffled order only for a board that uses it", () => {
    const view = renderComponent(
      <PostSort sort="random" random onSortChange={vi.fn()} />,
    );
    expect(view.getByRole("combobox", { name: "Sort" })).toHaveTextContent(
      "Shuffled",
    );
  });
});
