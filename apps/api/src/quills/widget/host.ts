import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { Hono, type Context } from "hono";

// The widget's iframe page and browser bundles, built by packages/widget into dist/host.js,
// dist/host.css, dist/browser.js, dist/capture.js and dist/fonts/inter-latin.woff2 (#316).
// These are static files: the routes read no database row and no credential, and the page takes
// the workspace from its own URL in the browser. That is why they are plain Hono routes and not
// defineQuillsRoute declarations; the contract's registered check and module boundary test exempt
// this module by name.

/** Build CSP for the widget iframe page, optionally restricting frame-ancestors (#320). */
export function buildWidgetPagePolicy(
  allowedOrigins?: readonly string[],
): string {
  const ancestors =
    allowedOrigins && allowedOrigins.length > 0
      ? ["'self'", ...allowedOrigins].join(" ")
      : "http: https:";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    // External immutable woff2 served from widget/fonts/inter-latin.woff2 (#316).
    "font-src 'self' data:",
    // blob: shows a screenshot that the visitor is about to attach (RFC 0003 feature 6).
    "img-src 'self' https: http: blob:",
    // A screenshot goes to the storage provider's presigned URL, whose origin depends on the
    // deployment. img-src already allows any HTTP(S) origin, so this adds no new way out.
    "connect-src 'self' https: http:",
    `frame-ancestors ${ancestors}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const PAGE_POLICY = buildWidgetPagePolicy();

/** packages/widget/dist above this module: in the source tree, the built API and the images. */
export function findWidgetDist(
  from = dirname(fileURLToPath(import.meta.url)),
): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const dist = join(dir, "packages/widget/dist");
    if (existsSync(join(dist, "browser.js"))) return dist;
    if (dirname(dir) === dir) return null;
  }
}

type Asset = {
  body: Uint8Array;
  gzip?: Uint8Array;
  br?: Uint8Array;
  version: string;
  mtimeMs: number;
};

/** `findDist` runs until it finds the bundles, so a widget built after the API started is served. */
export function widgetHost(
  findDist: () => string | null,
  resolveAllowedOrigins?: (workspace: string) => Promise<string[]>,
) {
  const cache = new Map<string, Asset>();
  let dist: string | null = null;
  const immutableFs = process.env.NODE_ENV === "production";
  /** A built file with its content hash and cached compressed variants (#316). */
  const asset = (name: string, compress = true) => {
    const cached = cache.get(name);
    if (immutableFs && cached) return cached;
    dist ??= findDist();
    if (!dist) return null;
    const file = join(dist, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      return null;
    }
    if (cached?.mtimeMs === mtimeMs) return cached;
    const body = readFileSync(file);
    const version = createHash("sha256")
      .update(body)
      .digest("hex")
      .slice(0, 16);
    const entry: Asset = {
      body,
      ...(compress
        ? {
            gzip: gzipSync(body, { level: 6 }),
            br: brotliCompressSync(body),
          }
        : {}),
      version,
      mtimeMs,
    };
    cache.set(name, entry);
    return entry;
  };
  const matchesEtag = (c: Context, etag: string) => {
    const header = c.req.header("if-none-match");
    if (!header) return false;
    return header
      .split(",")
      .some((part) => part.trim().replace(/^W\//, "") === etag);
  };
  const unbuilt = (c: Context) => {
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    return c.json(
      {
        message: "The widget is not built on this server",
        code: "SERVICE_UNAVAILABLE",
      },
      503,
    );
  };
  /** `?v=` with the current content hash caches for a year; any other URL for 5 minutes. */
  const file =
    (name: string, type: string, compress = true) =>
    (c: Context) => {
      const found = asset(name, compress);
      if (!found) return unbuilt(c);
      const etag = `"${found.version}"`;
      const cacheControl =
        c.req.query("v") === found.version
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300";
      c.header("ETag", etag);
      c.header("Cache-Control", cacheControl);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Cross-Origin-Resource-Policy", "cross-origin");
      if (compress) c.header("Vary", "Accept-Encoding");
      if (matchesEtag(c, etag)) return c.body(null, 304);
      c.header("Content-Type", type);
      if (compress) {
        const ae = c.req.header("accept-encoding") ?? "";
        if (found.br && /\bbr\b/i.test(ae)) {
          c.header("Content-Encoding", "br");
          return c.body(found.br as unknown as ArrayBuffer);
        }
        if (found.gzip && /\bgzip\b/i.test(ae)) {
          c.header("Content-Encoding", "gzip");
          return c.body(found.gzip as unknown as ArrayBuffer);
        }
      }
      return c.body(found.body as unknown as ArrayBuffer);
    };
  const renderWidgetPage = async (c: Context, trailingSlash: boolean) => {
    const script = asset("host.js");
    const style = asset("host.css");
    if (!script || !style) return unbuilt(c);
    const workspace = c.req.param("workspace");
    const allowedOrigins =
      resolveAllowedOrigins && workspace
        ? await resolveAllowedOrigins(workspace).catch(() => [])
        : [];
    const policy =
      allowedOrigins.length > 0
        ? buildWidgetPagePolicy(allowedOrigins)
        : PAGE_POLICY;
    const policyHash =
      allowedOrigins.length > 0
        ? `-${createHash("sha256").update(policy).digest("hex").slice(0, 8)}`
        : "";
    const etag = `"${script.version}-${style.version}${policyHash}"`;
    if (!c.res.headers.has("Content-Security-Policy")) {
      c.header("Content-Security-Policy", policy);
    }
    c.header("Cache-Control", "no-cache");
    c.header("ETag", etag);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    if (matchesEtag(c, etag)) return c.body(null, 304);
    const rawPath = new URL(c.req.url).pathname;
    const prefix =
      trailingSlash || rawPath.endsWith("/")
        ? "./"
        : `${rawPath.split("/").pop() || "widget"}/`;
    return c.html(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Support</title><link rel="stylesheet" href="${prefix}host.css?v=${style.version}"><script src="${prefix}host.js?v=${script.version}" defer></script></head><body><div id="root"></div></body></html>`,
    );
  };
  return (
    new Hono()
      // The SDK reads config.json and sdk.js from the host page's origin. Public and never
      // credentialed, with zero Set-Cookie headers (#318). Mount this router before ./index.
      .use("/:workspace/widget/*", async (c, next) => {
        await next();
        c.res.headers.delete("Set-Cookie");
      })
      .use("/:workspace/widget/config.json", async (c, next) => {
        await next();
        c.res.headers.delete("Access-Control-Allow-Credentials");
        c.res.headers.set("Access-Control-Allow-Origin", "*");
        if (!c.res.headers.has("Cross-Origin-Resource-Policy"))
          c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      })
      .use("/:workspace/widget/sdk.js", async (c, next) => {
        await next();
        c.res.headers.delete("Access-Control-Allow-Credentials");
        c.res.headers.set("Access-Control-Allow-Origin", "*");
      })
      .get("/:workspace/widget", (c) => renderWidgetPage(c, false))
      .get("/:workspace/widget/", (c) => renderWidgetPage(c, true))
      .get(
        "/:workspace/widget/host.js",
        file("host.js", "text/javascript; charset=utf-8"),
      )
      .get(
        "/:workspace/widget/host.css",
        file("host.css", "text/css; charset=utf-8"),
      )
      .get(
        "/:workspace/widget/sdk.js",
        file("browser.js", "text/javascript; charset=utf-8"),
      )
      .get(
        "/:workspace/widget/capture.js",
        file("capture.js", "text/javascript; charset=utf-8"),
      )
      .get(
        "/:workspace/widget/fonts/inter-latin.woff2",
        file("fonts/inter-latin.woff2", "font/woff2", false),
      )
  );
}

async function loadWorkspaceWidgetAllowedOrigins(
  workspace: string,
): Promise<string[]> {
  try {
    const [{ withQuillsAudience }, { settings }, { readWidgetAntiSpam }] =
      await Promise.all([
        import("../../database/quills/client"),
        import("../../database/quills/schema/auth"),
        import("../framework/anti-spam"),
      ]);
    return await withQuillsAudience({ workspace }, async (db) => {
      const [row] = await db
        .select({ widgetConfig: settings.widgetConfig })
        .from(settings)
        .limit(1);
      if (!row?.widgetConfig) return [];
      const parsed = JSON.parse(row.widgetConfig);
      if (!parsed || typeof parsed !== "object") return [];
      return readWidgetAntiSpam(parsed as Record<string, unknown>)
        .allowedOrigins;
    });
  } catch {
    return [];
  }
}

export default widgetHost(
  () => findWidgetDist(),
  loadWorkspaceWidgetAllowedOrigins,
);
