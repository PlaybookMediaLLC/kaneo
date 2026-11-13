import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from {{RENDER_PATH}};
import { {{NAME}} } from {{LOCAL}};
describe({{NAME_JSON}}, () => { it("declares the component", () => { void renderComponent; expect({{NAME}}).toBeTypeOf("function"); }); });
