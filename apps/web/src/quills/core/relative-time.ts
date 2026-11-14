const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** A short past time such as "8d ago" or "2y ago"; under a minute is "now". */
export function relativeTime(iso: string, locale: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  const match = units.find(([, size]) => seconds >= size);
  const format = new Intl.RelativeTimeFormat(locale, {
    style: "narrow",
    numeric: match ? "always" : "auto",
  });
  return match
    ? format.format(-Math.floor(seconds / match[1]), match[0])
    : format.format(0, "second");
}
