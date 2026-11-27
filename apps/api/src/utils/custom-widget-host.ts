import { getConnInfo } from "@hono/node-server/conninfo";
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import db from "../database";
import { createClientIpResolver } from "./client-ip";
import {
  clearWidgetHostCache,
  getCachedWidgetHost,
  setCachedWidgetHost,
} from "./widget-host-cache";

// Resolves verified custom widget domains (quills.custom_domains WHERE kind = 'widget')
// via the restricted SECURITY DEFINER lookup function `quills.custom_domain_workspace`
// with split positive/negative in-memory caches. Guarantees zero cookies on custom widget responses (#318).

export { clearWidgetHostCache };

const resolveProxyTrust = (() => {
  try {
    return createClientIpResolver(process.env.TRUSTED_PROXIES);
  } catch {
    return null;
  }
})();

export function normalizeHostHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  const noPort = first.replace(/:\d+$/, "").replace(/\.+$/, "");
  if (!noPort || noPort.length > 253 || !/^[a-z0-9.-]+$/.test(noPort))
    return null;
  return noPort;
}

export async function resolveWidgetCustomDomainWorkspace(
  hostHeader: string | undefined,
): Promise<string | null> {
  const host = normalizeHostHeader(hostHeader);
  if (!host) return null;
  const now = Date.now();
  const cached = getCachedWidgetHost(host, now);
  if (cached.hit) return cached.workspaceId;

  const result = await db.execute<{ workspace_id: string | null }>(
    sql`SELECT quills.custom_domain_workspace(${host}, 'widget') AS workspace_id`,
  );
  const workspaceId = result.rows[0]?.workspace_id ?? null;
  setCachedWidgetHost(host, workspaceId, now);
  return workspaceId;
}

function isFromTrustedProxy(c: Parameters<MiddlewareHandler>[0]): boolean {
  if (!resolveProxyTrust) return false;
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    return false;
  }
  if (!peer) return false;
  // Probe whether peer is in TRUSTED_PROXIES by checking if a synthetic forwarded IP is accepted.
  return resolveProxyTrust(peer, "203.0.113.1") === "203.0.113.1";
}

/**
 * Serves `/widget` and `/widget/*` on a workspace's verified custom widget domain by forwarding
 * to `/api/quills-public/{workspaceId}/widget*` with zero cookies (`Set-Cookie` stripped).
 */
export function customWidgetHostMiddleware(
  dispatch: (req: Request) => Response | Promise<Response>,
): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (path !== "/widget" && !path.startsWith("/widget/")) {
      return next();
    }
    const rawHost = isFromTrustedProxy(c)
      ? (c.req.header("x-forwarded-host") ?? c.req.header("host"))
      : c.req.header("host");
    const workspaceId = await resolveWidgetCustomDomainWorkspace(rawHost);
    if (!workspaceId) return next();

    const url = new URL(c.req.url);
    url.pathname = `/api/quills-public/${encodeURIComponent(workspaceId)}${path}`;
    const forwardedHeaders = new Headers(c.req.raw.headers);
    forwardedHeaders.delete("cookie");

    const hasBody =
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      c.req.raw.body !== null;
    const init: RequestInit & { duplex?: "half" } = {
      method: c.req.method,
      headers: forwardedHeaders,
      ...(hasBody ? { body: c.req.raw.body, duplex: "half" as const } : {}),
    };
    const res = await dispatch(new Request(url.toString(), init));
    const cleanHeaders = new Headers(res.headers);
    cleanHeaders.delete("set-cookie");
    if (path === "/widget/sdk.js" || path === "/widget/config.json") {
      cleanHeaders.delete("access-control-allow-credentials");
      cleanHeaders.set("Access-Control-Allow-Origin", "*");
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: cleanHeaders,
    });
  };
}
