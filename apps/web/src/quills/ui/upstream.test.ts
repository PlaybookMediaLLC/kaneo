import { describe, expect, it } from "vite-plus/test";
import { WorkspaceLayout } from "./upstream";

describe("upstream adapter", () => {
  it("loads the app header on demand to keep the app shell out of portal pages", () => {
    expect((WorkspaceLayout as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.lazy"),
    );
  });
});
