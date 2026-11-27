// Zero-DB cache store for custom widget host lookups so both root server middleware
// (src/utils/custom-widget-host.ts) and Quills domain routes/jobs can invalidate it
// without introducing a database import under src/quills/ (#318).

const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 15_000;
const MAX_POSITIVE_ENTRIES = 500;
const MAX_NEGATIVE_ENTRIES = 500;

const positiveCache = new Map<
  string,
  { workspaceId: string; expiresAt: number }
>();
const negativeCache = new Map<string, number>();

export function getCachedWidgetHost(
  host: string,
  now = Date.now(),
): { hit: true; workspaceId: string | null } | { hit: false } {
  const pos = positiveCache.get(host);
  if (pos && pos.expiresAt > now) {
    return { hit: true, workspaceId: pos.workspaceId };
  }
  if (pos) positiveCache.delete(host);

  const negExp = negativeCache.get(host);
  if (negExp && negExp > now) {
    return { hit: true, workspaceId: null };
  }
  if (negExp) negativeCache.delete(host);

  return { hit: false };
}

export function setCachedWidgetHost(
  host: string,
  workspaceId: string | null,
  now = Date.now(),
) {
  if (workspaceId) {
    negativeCache.delete(host);
    if (positiveCache.size >= MAX_POSITIVE_ENTRIES) {
      const oldest = positiveCache.keys().next().value;
      if (oldest) positiveCache.delete(oldest);
    }
    positiveCache.set(host, { workspaceId, expiresAt: now + POSITIVE_TTL_MS });
  } else {
    positiveCache.delete(host);
    if (negativeCache.size >= MAX_NEGATIVE_ENTRIES) {
      const oldest = negativeCache.keys().next().value;
      if (oldest) negativeCache.delete(oldest);
    }
    negativeCache.set(host, now + NEGATIVE_TTL_MS);
  }
}

export function clearWidgetHostCache(host?: string) {
  if (host) {
    const normalized = host.trim().toLowerCase();
    positiveCache.delete(normalized);
    negativeCache.delete(normalized);
    return;
  }
  positiveCache.clear();
  negativeCache.clear();
}
