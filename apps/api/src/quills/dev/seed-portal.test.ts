import { describe, expect, it } from "vite-plus/test";
import { assertPortalSeedEnvironment } from "./seed-portal";

describe("portal demo seed", () => {
  it("refuses production", () => {
    expect(() =>
      assertPortalSeedEnvironment(
        "production",
        "postgresql://postgres@localhost/kaneo",
      ),
    ).toThrow("NODE_ENV=production");
  });

  it("refuses a non-local database host", () => {
    expect(() =>
      assertPortalSeedEnvironment(
        "development",
        "postgresql://postgres@db.example.test/kaneo",
      ),
    ).toThrow("local PostgreSQL host");
  });

  it.each(["localhost", "127.0.0.1"])("accepts %s", (host) => {
    expect(() =>
      assertPortalSeedEnvironment(
        "development",
        `postgresql://postgres@${host}/kaneo`,
      ),
    ).not.toThrow();
  });
});
