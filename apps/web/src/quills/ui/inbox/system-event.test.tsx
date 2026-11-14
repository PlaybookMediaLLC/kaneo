import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { SystemEvent } from "./system-event";

describe("SystemEvent", () => {
  it("shows the event text and its time", () => {
    const view = renderComponent(
      <SystemEvent time="2026-10-31T13:18:00.000Z">
        You resolved this conversation
      </SystemEvent>,
    );
    expect(view.getByText("You resolved this conversation")).toBeVisible();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-31T13:18:00.000Z",
    );
  });

  it("leaves out the time when there is none", () => {
    const view = renderComponent(<SystemEvent>Email bounced</SystemEvent>);
    expect(view.container.querySelector("time")).toBeNull();
  });
});
