import { resolveApiBaseUrl } from "@kaneo/libs";

/**
 * Returns the configured API origin (without trailing `/api`) so direct fetch calls work in
 * both bundled same-origin and separately-hosted API/web deployments.
 */
export function apiOrigin(
  viteApiUrl: string | undefined = import.meta.env.VITE_API_URL,
): string {
  return resolveApiBaseUrl(viteApiUrl).replace(/\/api$/, "");
}
