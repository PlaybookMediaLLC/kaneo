import { describe, expect, it } from "vite-plus/test";
import { ResultCard } from "./result-card";
import { renderComponent } from "../test/render";

describe("ResultCard", () => {
  it("announces a successful result", () => {
    const view = renderComponent(<ResultCard titleKey="core.gallery.result" />);
    expect(view.getByRole("status")).toBeInTheDocument();
  });
});
