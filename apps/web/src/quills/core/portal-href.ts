export function portalHref(
  workspaceId: string,
  path = "",
  search?: Record<string, string | number | undefined>,
): string {
  const base = `/portal/${encodeURIComponent(workspaceId)}`;
  const pathname = path ? `${base}/${path.replace(/^\//, "")}` : base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
