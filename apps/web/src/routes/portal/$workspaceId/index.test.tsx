import { describe, expect, it } from "vite-plus/test";
import { describeRouteContract } from "@/quills/test/contracts";
import { Route } from "./index";
describeRouteContract(Route);

describe("feedback home search", () => {
  const parse = (search: Record<string, unknown>) => {
    const validator = Route.options.validateSearch;
    if (!validator || !("parse" in validator))
      throw new Error("Expected route schema");
    return validator.parse(search) as { title?: string };
  };
  it("keeps a composer title that the router read as a number or boolean", () => {
    expect(parse({ title: 404 })).toMatchObject({ title: "404" });
    expect(parse({ title: true })).toMatchObject({ title: "true" });
    expect(parse({})).not.toHaveProperty("title");
  });
  it("cuts a long title to the API limit without splitting an emoji", () => {
    expect(parse({ title: "x".repeat(250) }).title).toHaveLength(200);
    expect(parse({ title: `${"x".repeat(199)}🚀` }).title).toBe(
      "x".repeat(199),
    );
  });
});
