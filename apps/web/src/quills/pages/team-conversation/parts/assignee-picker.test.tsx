import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { AssigneePicker } from "./assignee-picker";

const people = ["Ada", "Lin"].map((name, index) => ({
  id: `principal_test_${index + 1}`,
  userId: `user_test_${index + 1}`,
  name,
  avatarUrl: null,
  role: "member",
  createdAt: "2026-01-01T00:00:00.000Z",
}));

describe("AssigneePicker", () => {
  it("reads Assign without an assignee and picks a teammate", async () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <AssigneePicker
        value={null}
        people={people}
        myPrincipalId="principal_test_1"
        onChange={onChange}
      />,
    );
    press("Assignee: Assign");
    expect(
      await view.findByRole("menuitemradio", { name: "Unassigned" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      view.getByRole("menuitemradio", { name: /Ada \(you\)/ }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("menuitemradio", { name: /Lin/ }));
    expect(onChange).toHaveBeenCalledWith("principal_test_2");
  });

  it("reads You when the conversation is mine, and unassigns", async () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <AssigneePicker
        value="principal_test_1"
        people={people}
        myPrincipalId="principal_test_1"
        onChange={onChange}
      />,
    );
    press("Assignee: You");
    fireEvent.click(
      await view.findByRole("menuitemradio", { name: "Unassigned" }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("names another teammate", () => {
    const view = renderComponent(
      <AssigneePicker
        value="principal_test_2"
        people={people}
        myPrincipalId="principal_test_1"
        disabled
        onChange={() => undefined}
      />,
    );
    expect(view.getByRole("button", { name: "Assignee: Lin" })).toBeDisabled();
  });
});
