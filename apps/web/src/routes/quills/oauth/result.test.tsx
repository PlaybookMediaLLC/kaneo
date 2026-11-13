import { describe, expect, it } from "vite-plus/test";
import { describeRouteContract } from "@/quills/test/contracts";
import { i18n } from "@/quills/ui/upstream";
import { Route } from "./result";

describeRouteContract({ Route, expectedSearch: { outcome: "failed" } });

describe("OAuth result route", () => {
  it("loads Quills translations outside the portal layout", async () => {
    const beforeLoad = Route.options.beforeLoad as () => Promise<void>;
    await beforeLoad();
    expect(i18n.hasResourceBundle("en-US", "quills")).toBe(true);
  });

  it("accepts only declared outcome and display-name search values", () => {
    const schema = Route.options.validateSearch as {
      parse: (value: unknown) => unknown;
    };
    expect(
      schema.parse({ outcome: "connected", name: "Trello", code: "secret" }),
    ).toEqual({ outcome: "connected", name: "Trello" });
    expect(schema.parse({ outcome: "provider_error" })).toEqual({
      outcome: "failed",
    });
    expect(schema.parse({})).toEqual({ outcome: "failed" });
    expect(schema.parse({ outcome: "failed", name: "x".repeat(201) })).toEqual({
      outcome: "failed",
      name: undefined,
    });
  });
});
