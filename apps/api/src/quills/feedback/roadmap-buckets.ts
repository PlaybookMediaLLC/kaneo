// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// Date buckets of a time-based roadmap, ported from Quackback's lib/shared/roadmap-config.ts.

export type Frequency = "monthly" | "quarterly" | "semiannual";
export type Bucket = {
  id: string;
  label: string;
  start: string | null;
  end: string | null;
  targetMonth: string | null;
  noEta: boolean;
};

const NO_ETA = "no-eta";
// ponytail: the listed range stops 50 periods each side of now; a far-off ETA stays reachable by its bucket ID.
const MAX_SPAN = 50;
const months = { monthly: 1, quarterly: 3, semiannual: 6 } as const;

const addMonths = (date: Date, count: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));

const startOfPeriod = (date: Date, frequency: Frequency) => {
  const size = months[frequency];
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      Math.floor(date.getUTCMonth() / size) * size,
      1,
    ),
  );
};

export function bucketFor(date: Date, frequency: Frequency): Bucket {
  const start = startOfPeriod(date, frequency);
  const size = months[frequency];
  const year = start.getUTCFullYear();
  const period = Math.floor(start.getUTCMonth() / size) + 1;
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  const id =
    frequency === "monthly"
      ? `${year}-${month}`
      : `${year}-${frequency === "quarterly" ? "Q" : "H"}${period}`;
  const label =
    frequency === "monthly"
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(start)
      : `${frequency === "quarterly" ? "Q" : "H"}${period} ${year}`;
  return {
    id,
    label,
    start: start.toISOString(),
    end: addMonths(start, size).toISOString(),
    targetMonth: addMonths(start, size - 1).toISOString(),
    noEta: false,
  };
}

const noEtaBucket = (): Bucket => ({
  id: NO_ETA,
  label: "No ETA",
  start: null,
  end: null,
  targetMonth: null,
  noEta: true,
});

/** The bucket a client named, or null when the ID does not fit the frequency. */
export function parseBucket(id: string, frequency: Frequency): Bucket | null {
  if (id === NO_ETA) return noEtaBucket();
  const pattern = {
    monthly: /^(\d{4})-(0[1-9]|1[0-2])$/,
    quarterly: /^(\d{4})-Q([1-4])$/,
    semiannual: /^(\d{4})-H([1-2])$/,
  }[frequency];
  const match = pattern.exec(id);
  if (!match) return null;
  const month = (Number(match[2]) - 1) * months[frequency];
  const bucket = bucketFor(
    new Date(Date.UTC(Number(match[1]), month, 1)),
    frequency,
  );
  return bucket.id === id ? bucket : null;
}

/** Every bucket from the earliest to the latest ETA, always including now, then "No ETA". */
export function bucketsBetween(
  frequency: Frequency,
  minEta: Date | null,
  maxEta: Date | null,
  now = new Date(),
): Bucket[] {
  const current = startOfPeriod(now, frequency);
  const size = months[frequency];
  const earliest = addMonths(current, -MAX_SPAN * size);
  const latest = addMonths(current, MAX_SPAN * size);
  const first = minEta ? startOfPeriod(minEta, frequency) : current;
  const last = maxEta ? startOfPeriod(maxEta, frequency) : current;
  const from =
    first < current ? (first < earliest ? earliest : first) : current;
  const to = last > current ? (last > latest ? latest : last) : current;
  const buckets: Bucket[] = [];
  for (let cursor = from; cursor <= to; cursor = addMonths(cursor, size))
    buckets.push(bucketFor(cursor, frequency));
  buckets.push(noEtaBucket());
  return buckets;
}
