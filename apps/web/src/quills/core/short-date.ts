const DAY = 86_400_000;
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);

/**
 * The date of a list row: "now" under a minute, the time today, "Oct 31" this year and
 * "Oct 31, 2025" before. A future time counts as now.
 */
export function shortDate(iso: string, locale: string, now = Date.now()) {
  const time = Date.parse(iso);
  if (now - time < 60_000)
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      0,
      "second",
    );
  if (startOfDay(time) === startOfDay(now)) return clockTime(iso, locale);
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return new Date(time).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The time of day, such as "1:18 PM", for a message or an event. */
export const clockTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });

/** The day of a thread separator: 0 is today, 1 is yesterday, else the long date. */
export function dayOf(iso: string, locale: string, now = Date.now()) {
  const days = Math.round(
    (startOfDay(now) - startOfDay(Date.parse(iso))) / DAY,
  );
  return {
    daysAgo: days,
    label: new Date(iso).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  };
}
