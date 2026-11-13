import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { LanguagePreferenceForm } from "./language-preference-form";

describe("LanguagePreferenceForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <LanguagePreferenceForm initialLanguage="en" onSubmit={onSubmit} />,
      ),
    fieldName: "Language preference",
    issuePath: "language",
    submitName: "Save language",
    validValue: "pt-BR",
    expectedValues: { language: "pt-BR" },
    invalidValue: "not a tag",
  });
  it("submits a language and clears it to the portal default", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <LanguagePreferenceForm initialLanguage="en" onSubmit={onSubmit} />,
    );
    expect(
      view.getByRole("textbox", { name: "Language preference" }),
    ).toHaveValue("en");
    fill("Language preference", "");
    press("Save language");
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ language: null }),
    );
  });
});
