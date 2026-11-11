import { describe, expect, it } from "vite-plus/test";
import { bucketFor, bucketsBetween, parseBucket } from "./roadmap-buckets";

const now = new Date("2026-05-15T12:00:00Z");

describe("roadmap date buckets", () => {
  it("names monthly, quarterly and half-year buckets", () => {
    expect(bucketFor(now, "monthly")).toMatchObject({
      id: "2026-05",
      label: "May 2026",
      start: "2026-05-01T00:00:00.000Z",
      end: "2026-06-01T00:00:00.000Z",
    });
    expect(bucketFor(now, "quarterly").id).toBe("2026-Q2");
    expect(bucketFor(now, "semiannual")).toMatchObject({
      id: "2026-H1",
      targetMonth: "2026-06-01T00:00:00.000Z",
    });
  });

  it("parses only IDs that fit the frequency", () => {
    expect(parseBucket("2026-Q3", "quarterly")?.start).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parseBucket("no-eta", "monthly")?.noEta).toBe(true);
    expect(parseBucket("2026-Q3", "monthly")).toBeNull();
    expect(parseBucket("2026-13", "monthly")).toBeNull();
  });

  it("spans the ETAs and now, and bounds a far-off ETA", () => {
    expect(
      bucketsBetween(
        "monthly",
        new Date("2026-03-02T00:00:00Z"),
        new Date("2026-04-01T00:00:00Z"),
        now,
      ).map((b) => b.id),
    ).toEqual(["2026-03", "2026-04", "2026-05", "no-eta"]);
    expect(
      bucketsBetween("monthly", new Date("1990-01-01T00:00:00Z"), null, now),
    ).toHaveLength(52);
  });
});
