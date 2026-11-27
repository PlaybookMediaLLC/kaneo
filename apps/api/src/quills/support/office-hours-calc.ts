import { z } from "../../openapi";

export const officeHoursIntervalSchema = z.object({
  day: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const officeHoursHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().max(120).optional(),
  recurringAnnual: z.boolean().optional(),
});

export const officeHoursInputSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().default("UTC"),
  intervals: z.array(officeHoursIntervalSchema).default([]),
  holidays: z.array(officeHoursHolidaySchema).default([]),
});

function createLocalFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localParts(now: Date, formatter: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday!,
    ),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function isOpenAt(
  hours: z.output<typeof officeHoursInputSchema>,
  instant: Date,
  formatter: Intl.DateTimeFormat,
): boolean {
  if (!hours.enabled) return true;
  if (hours.intervals.length === 0) return false;
  const local = localParts(instant, formatter);
  if (
    hours.holidays.some(
      (h) =>
        h.date === local.date ||
        (h.recurringAnnual && h.date.slice(5) === local.date.slice(5)),
    )
  ) {
    return false;
  }
  const yesterday = (local.day + 6) % 7;
  return hours.intervals.some(({ day, start, end }) => {
    if (start === end) return false;
    return start < end
      ? day === local.day && local.time >= start && local.time < end
      : (day === local.day && local.time >= start) ||
          (day === yesterday && local.time < end);
  });
}

/**
 * Computes whether office hours are currently open and, when closed, the next ISO
 * timestamp when the team opens (scanning up to 14 days ahead in 15-minute steps,
 * then refining to the exact minute, #333).
 */
export function computeOfficeHoursStatus(
  stored: unknown,
  now = new Date(),
): {
  withinOfficeHours: boolean;
  nextOpenAt: string | null;
  timezone: string | null;
} {
  const parsed = officeHoursInputSchema.safeParse(stored);
  if (!parsed.success || !parsed.data.enabled) {
    return { withinOfficeHours: true, nextOpenAt: null, timezone: null };
  }
  const hours = parsed.data;
  if (hours.intervals.length === 0) {
    return {
      withinOfficeHours: false,
      nextOpenAt: null,
      timezone: hours.timezone,
    };
  }
  try {
    const formatter = createLocalFormatter(hours.timezone);
    if (isOpenAt(hours, now, formatter)) {
      return {
        withinOfficeHours: true,
        nextOpenAt: null,
        timezone: hours.timezone,
      };
    }
    const baseMs = Math.ceil(now.getTime() / 60_000) * 60_000;
    const stepMs = 15 * 60_000;
    const maxSteps = (14 * 24 * 60) / 15;
    for (let step = 1; step <= maxSteps; step += 1) {
      const probe = new Date(baseMs + step * stepMs);
      if (isOpenAt(hours, probe, formatter)) {
        // Refine back up to 15 minutes (inclusive) so openings right at baseMs are exact.
        let exactMs = probe.getTime();
        for (let m = 1; m <= 15; m += 1) {
          const earlier = new Date(probe.getTime() - m * 60_000);
          if (
            earlier.getTime() > now.getTime() &&
            isOpenAt(hours, earlier, formatter)
          ) {
            exactMs = earlier.getTime();
          } else {
            break;
          }
        }
        return {
          withinOfficeHours: false,
          nextOpenAt: new Date(exactMs).toISOString(),
          timezone: hours.timezone,
        };
      }
    }
    return {
      withinOfficeHours: false,
      nextOpenAt: null,
      timezone: hours.timezone,
    };
  } catch {
    return { withinOfficeHours: true, nextOpenAt: null, timezone: null };
  }
}

/** Formats p25/p50/p75 wait minutes into an honest, human-friendly range (#333). */
export function formatWaitEstimate(
  p25Minutes: number,
  p50Minutes: number,
  p75Minutes: number,
): {
  minMinutes: number;
  maxMinutes: number;
  medianMinutes: number;
  label: string;
} {
  const min = Math.max(1, Math.round(p25Minutes));
  const median = Math.max(min, Math.round(p50Minutes));
  const max = Math.max(median, Math.round(p75Minutes));

  if (max <= 10) {
    return {
      minMinutes: min,
      maxMinutes: max,
      medianMinutes: median,
      label: "under 10 minutes",
    };
  }
  if (max < 60) {
    const low = Math.max(5, Math.floor(min / 5) * 5);
    const high = Math.ceil(max / 5) * 5;
    return {
      minMinutes: min,
      maxMinutes: max,
      medianMinutes: median,
      label: low === high ? `about ${high} minutes` : `${low}–${high} minutes`,
    };
  }
  const lowH = Math.max(1, Math.floor(min / 60));
  const highH = Math.max(lowH, Math.ceil(max / 60));
  if (highH <= 24) {
    return {
      minMinutes: min,
      maxMinutes: max,
      medianMinutes: median,
      label:
        lowH === highH
          ? `about ${highH} ${highH === 1 ? "hour" : "hours"}`
          : `${lowH}–${highH} hours`,
    };
  }
  const days = Math.max(1, Math.round(median / (60 * 24)));
  return {
    minMinutes: min,
    maxMinutes: max,
    medianMinutes: median,
    label: days === 1 ? "about 1 business day" : `about ${days} days`,
  };
}

export type PlainCustomerStatus =
  | "received"
  | "in_progress"
  | "awaiting_requester"
  | "resolved";

/** Projects internal conversation state into plain customer-friendly status (#333). */
export function projectCustomerStatus(conv: {
  status: string;
  firstResponseAt?: Date | null;
  assignedAgentPrincipalId?: string | null;
  solutionOfferedAt?: Date | null;
}): PlainCustomerStatus {
  if (conv.status === "closed") return "resolved";
  if (conv.solutionOfferedAt) return "awaiting_requester";
  if (conv.firstResponseAt || conv.assignedAgentPrincipalId)
    return "in_progress";
  return "received";
}
