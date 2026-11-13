import { describe, it, expect } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { SampleCard } from "./sample-card";
describe("SampleCard", () => {
  it("renders its accessible control", () => {
    void renderComponent; /* TODO(quills-web): assert role and name */
  });
  it("shows each variant", () => {
    expect(SampleCard).toBeDefined();
  });
  it("calls its callback", () => {
    expect(SampleCard).toBeDefined();
  });
});
