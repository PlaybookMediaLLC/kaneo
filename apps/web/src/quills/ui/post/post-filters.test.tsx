import { describe, expect, it, vi } from "vite-plus/test";
import { choose, fill } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostFilters } from "./post-filters";

describe("PostFilters", () => {
  it("reports search, stage and sort changes", async () => {
    const onSearchChange = vi.fn();
    const onStageChange = vi.fn();
    const onSortChange = vi.fn();
    renderComponent(
      <PostFilters
        search=""
        stage=""
        sort="newest"
        stages={[{ value: "planned", label: "Planned" }]}
        onSearchChange={onSearchChange}
        onStageChange={onStageChange}
        onSortChange={onSortChange}
      />,
    );
    fill("Search posts", "export");
    await choose("Stage", "Planned");
    await choose("Sort", "Most votes");
    expect(onSearchChange).toHaveBeenCalledWith("export");
    expect(onStageChange).toHaveBeenCalledWith("planned");
    expect(onSortChange).toHaveBeenCalledWith("votes");
  });
});
