import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { SurveyBars } from "./survey-bars";

describe("SurveyBars", () => {
  it("names each bar with its label and count", () => {
    const view = renderComponent(
      <SurveyBars
        rows={[
          { label: "CSV", count: 3 },
          { label: "PDF", count: 1 },
        ]}
        total={4}
      />,
    );
    const bar = view.getByRole("meter", { name: "CSV: 3 of 4" });
    expect(bar).toHaveAttribute("value", "3");
    expect(bar).toHaveAttribute("max", "4");
    expect(view.getByRole("meter", { name: "PDF: 1 of 4" })).toBeVisible();
  });

  it("keeps an empty bar valid when nobody answered", () => {
    const view = renderComponent(
      <SurveyBars rows={[{ label: "0", count: 0 }]} total={0} />,
    );
    expect(view.getByRole("meter", { name: "0: 0 of 0" })).toHaveAttribute(
      "max",
      "1",
    );
  });
});
