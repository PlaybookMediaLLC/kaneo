import { describe, expect, it } from "vite-plus/test";
import {
  computeOfficeHoursStatus,
  formatWaitEstimate,
  projectCustomerStatus,
} from "./office-hours-calc";

describe("office-hours-calc (#333)", () => {
  it("computes nextOpenAt across weekend and holiday closures", () => {
    const schedule = {
      enabled: true,
      timezone: "UTC",
      intervals: [
        { day: 1, start: "09:00", end: "17:00" }, // Mon
        { day: 2, start: "09:00", end: "17:00" }, // Tue
      ],
      holidays: [{ date: "2026-11-16", name: "Holiday Monday" }],
    };
    // Saturday Nov 14 2026 12:00 UTC -> Monday Nov 16 is a holiday -> opens Tuesday Nov 17 at 09:00 UTC
    const res = computeOfficeHoursStatus(
      schedule,
      new Date("2026-11-14T12:00:00.000Z"),
    );
    expect(res.withinOfficeHours).toBe(false);
    expect(res.nextOpenAt).toBe("2026-11-17T09:00:00.000Z");

    // During Tuesday open hours
    const openRes = computeOfficeHoursStatus(
      schedule,
      new Date("2026-11-17T10:30:00.000Z"),
    );
    expect(openRes.withinOfficeHours).toBe(true);
    expect(openRes.nextOpenAt).toBeNull();

    // 30 seconds before opening (08:59:30 UTC -> opens at exact 09:00:00 UTC)
    const justBefore = computeOfficeHoursStatus(
      schedule,
      new Date("2026-11-17T08:59:30.000Z"),
    );
    expect(justBefore.withinOfficeHours).toBe(false);
    expect(justBefore.nextOpenAt).toBe("2026-11-17T09:00:00.000Z");

    // Empty intervals return immediately with null nextOpenAt
    const empty = computeOfficeHoursStatus(
      { enabled: true, timezone: "UTC", intervals: [], holidays: [] },
      new Date("2026-11-17T08:00:00.000Z"),
    );
    expect(empty.withinOfficeHours).toBe(false);
    expect(empty.nextOpenAt).toBeNull();
  });

  it("handles DST transitions accurately in America/New_York", () => {
    const schedule = {
      enabled: true,
      timezone: "America/New_York",
      intervals: [{ day: 1, start: "09:00", end: "17:00" }],
      holidays: [],
    };
    // Sunday Mar 8 2026 is US spring-forward -> Monday Mar 9 09:00 EDT = 13:00 UTC
    const res = computeOfficeHoursStatus(
      schedule,
      new Date("2026-03-08T12:00:00.000Z"),
    );
    expect(res.withinOfficeHours).toBe(false);
    expect(res.nextOpenAt).toBe("2026-03-09T13:00:00.000Z");
  });

  it("formats honest wait-time ranges", () => {
    expect(formatWaitEstimate(2, 4, 8).label).toBe("under 10 minutes");
    expect(formatWaitEstimate(15, 25, 42).label).toBe("15–45 minutes");
    expect(formatWaitEstimate(70, 95, 130).label).toBe("1–3 hours");
  });

  it("projects internal conversation state to plain customer status", () => {
    expect(projectCustomerStatus({ status: "open" })).toBe("received");
    expect(
      projectCustomerStatus({
        status: "open",
        assignedAgentPrincipalId: "p_1",
      }),
    ).toBe("in_progress");
    expect(
      projectCustomerStatus({ status: "open", solutionOfferedAt: new Date() }),
    ).toBe("awaiting_requester");
    expect(projectCustomerStatus({ status: "closed" })).toBe("resolved");
  });
});
