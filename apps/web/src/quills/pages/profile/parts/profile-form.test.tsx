import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { ProfileForm } from "./profile-form";

describe("ProfileForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(<ProfileForm initialName="Ada" onSubmit={onSubmit} />),
    fieldName: "Display name",
    issuePath: "name",
    submitName: "Save profile",
    validValue: "Grace",
    expectedValues: { name: "Grace" },
    invalidValue: "",
  });
  it("labels and submits the display name", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <ProfileForm initialName="Ada" onSubmit={onSubmit} />,
    );
    expect(view.getByRole("textbox", { name: "Display name" })).toHaveValue(
      "Ada",
    );
    fill("Display name", "Grace");
    press("Save profile");
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ name: "Grace" }),
    );
  });
});
