import { describe, expect, it } from "vite-plus/test";
import { catalog } from "./catalog";

describe("integration catalog", () => {
  // A provider in providers/ must use the integration type of its "not available" entry as its key.
  it("lists each provider once", () => {
    const ids = catalog.map((entry) => entry.id);
    const names = catalog.map((entry) => entry.name);
    expect(ids.length).toBe(new Set(ids).size);
    expect(names.length).toBe(new Set(names).size);
  });
});
