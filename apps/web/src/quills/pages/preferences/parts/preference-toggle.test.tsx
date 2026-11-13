import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { PreferenceToggle } from "./preference-toggle";

describe("PreferenceToggle", () => {
  it("announces current state and supports the reverse action", () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const view = renderComponent(
      <PreferenceToggle
        labelKey="preferences.changelog"
        checked
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(
      view.getByRole("switch", { name: "Changelog email updates" }),
    ).toBeChecked();
    view.getByRole("switch", { name: "Changelog email updates" }).click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("refuses to change the preference inside a frame", async () => {
    vi.stubGlobal("top", {});
    try {
      const onChange = vi.fn().mockResolvedValue(undefined);
      const view = renderComponent(
        <PreferenceToggle
          labelKey="preferences.changelog"
          checked={false}
          disabled={false}
          onChange={onChange}
        />,
      );

      view.getByRole("switch", { name: "Changelog email updates" }).click();

      expect(await view.findByRole("alert")).toHaveTextContent(/new tab/i);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
