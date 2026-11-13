export function portalReturnPath(href: string): string {
  const url = new URL(href, "https://portal.invalid");
  url.searchParams.delete("token");
  if (new URLSearchParams(url.hash.slice(1)).has("token")) url.hash = "";
  return `${url.pathname}${url.search}${url.hash}`;
}
