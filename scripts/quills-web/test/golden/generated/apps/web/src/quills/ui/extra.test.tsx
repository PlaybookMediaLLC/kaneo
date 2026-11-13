import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { Extra } from "./extra";
describe("Extra", () => {
  it("declares the component", () => {
    void renderComponent;
    expect(Extra).toBeTypeOf("function");
  });
});
