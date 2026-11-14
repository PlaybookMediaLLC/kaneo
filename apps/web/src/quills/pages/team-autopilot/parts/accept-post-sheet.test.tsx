import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import { AcceptPostSheet } from "./accept-post-sheet";

const boards = [{ id: "board_test_1", name: "Ideas" }];

describe("AcceptPostSheet", () => {
  it("opens with the suggested title of the signal", async () => {
    const view = renderComponent(
      <AcceptPostSheet
        signal={signalsFixture.signal()}
        boards={boards}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );
    expect(
      await view.findByRole("dialog", { name: "Accept as a new post" }),
    ).toBeInTheDocument();
    expect(view.getByLabelText("Post title")).toHaveValue("Dark theme");
  });

  it("stays closed without a signal", () => {
    const view = renderComponent(
      <AcceptPostSheet
        signal={null}
        boards={boards}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );
    expect(view.queryByRole("dialog")).toBeNull();
  });
});
