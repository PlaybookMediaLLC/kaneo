import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { inboxBoards } from "../inbox.fixture";
import { PostFilters } from "./post-filters";

const boards = inboxBoards.items;

describe("PostFilters", () => {
  it("changes the board and the sort", () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <PostFilters boards={boards} search={{}} onChange={onChange} />,
    );
    fireEvent.change(view.getByLabelText("Board"), {
      target: { value: "board_ideas" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ board: "board_ideas" });
    fireEvent.change(view.getByLabelText("Board"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ board: undefined });
    fireEvent.change(view.getByLabelText("Sort"), {
      target: { value: "votes" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ sort: "votes" });
  });

  it("sends a typed search once, after a pause", async () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <PostFilters boards={boards} search={{}} onChange={onChange} />,
    );
    fireEvent.change(view.getByRole("searchbox", { name: "Search posts" }), {
      target: { value: " export " },
    });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ q: "export" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
