import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { BoardSelect } from "./board-select";

describe("BoardSelect", () => {
  it("names the picker and shows the chosen board", () => {
    const view = renderComponent(
      <BoardSelect
        name="boardId"
        boards={[
          { id: "board_test_1", name: "Ideas" },
          { id: "board_test_2", name: "Bugs" },
        ]}
        value="board_test_2"
        onChange={vi.fn()}
      />,
    );
    expect(view.getByRole("combobox", { name: "Board" })).toHaveTextContent(
      "Bugs",
    );
  });
});
