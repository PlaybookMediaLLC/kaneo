export function retryAfterAt(value: string | null, now = Date.now()): number {
  if (value && /^\d+$/.test(value.trim())) {
    const seconds = Number(value);
    if (Number.isSafeInteger(now + seconds * 1000)) return now + seconds * 1000;
  }
  const date =
    value && /^[A-Za-z]{3},\s/.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isFinite(date) ? Math.max(now, date) : now + 30_000;
}
