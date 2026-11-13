import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { checkConformance } from "../../../../scripts/quills-web/lib/rules/check.mjs";

describe("Quills web conformance", () => {
  it("passes the same rules as the CLI", async () => {
    const root = resolve(import.meta.dirname, "../../../..");
    expect(await checkConformance(root)).toEqual([]);
  }, 30_000);
});
