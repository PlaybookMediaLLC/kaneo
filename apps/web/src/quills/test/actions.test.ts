import { screen } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "./actions";
import { renderComponent } from "./render";

describe("test actions", () => {
  it("fills labelled fields and presses accessible buttons", () => {
    const pressed = vi.fn();
    renderComponent(
      createElement(
        Fragment,
        null,
        createElement("label", { htmlFor: "message" }, "Message"),
        createElement("input", { id: "message" }),
        createElement("button", { type: "button", onClick: pressed }, "Send"),
      ),
    );

    fill("Message", "Hello");
    press("Send");

    expect(screen.getByLabelText("Message")).toHaveValue("Hello");
    expect(pressed).toHaveBeenCalledOnce();
  });
});
