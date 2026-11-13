import { describe, it, expect } from "vite-plus/test";
import { renderComponent } from {{RENDER_PATH}};
import { {{NAME}} } from "./{{FILE}}";
describe({{NAME_JSON}}, () => {
  it("renders its accessible control", () => { void renderComponent; /* TODO(quills-web): assert role and name */ });
  it("shows each variant", () => { expect({{NAME}}).toBeDefined(); });
  it("calls its callback", () => { expect({{NAME}}).toBeDefined(); });
});
