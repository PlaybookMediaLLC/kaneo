import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";

// The widget's iframe page and browser bundles, built by packages/widget into dist/host.js,
// dist/host.css and dist/browser.js. These are static files: the routes read no database row
// and no credential, and the page takes the workspace from its own URL in the browser, so
// nothing from the request is written into a response. That is why they are plain Hono routes
// and not defineQuillsRoute declarations; the contract's registered check and the module
// boundary test exempt this module by name.

/** The workspace's widget data routes are same-origin; any web page may embed the frame. */
const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src data:",
  // blob: shows a screenshot that the visitor is about to attach (RFC 0003 feature 6).
  "img-src 'self' https: http: blob:",
  // A screenshot goes to the storage provider's presigned URL, whose origin depends on the
  // deployment. img-src already allows any HTTP(S) origin, so this adds no new way out.
  "connect-src 'self' https: http:",
  // The widget config has no allowed-origin list. A framing page gets an anonymous session
  // only: identify needs a token that the host app's backend signs with the widget secret.
  "frame-ancestors http: https:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

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

type Asset = { body: string; version: string; mtimeMs: number };

/** `findDist` runs until it finds the bundles, so a widget built after the API started is served. */
export function widgetHost(findDist: () => string | null) {
  const cache = new Map<string, Asset>();
  let dist: string | null = null;
  const immutableFs = process.env.NODE_ENV === "production";
  /** A built file with its content hash; read again after a rebuild outside production. */
  const asset = (name: string) => {
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
    const body = readFileSync(file, "utf8");
    const version = createHash("sha256")
      .update(body)
      .digest("hex")
      .slice(0, 16);
    cache.set(name, { body, version, mtimeMs });
    return cache.get(name)!;
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
  const file = (name: string, type: string) => (c: Context) => {
    const found = asset(name);
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
    if (matchesEtag(c, etag)) return c.body(null, 304);
    c.header("Content-Type", type);
    return c.body(found.body);
  };
  return (
    new Hono()
      // The SDK reads config.json from the host page's origin. It is public and never
      // credentialed, while the app's CORS allowlist is for credentialed origins, so this
      // response alone may be read by any origin. Mount this router before ./index.
      .use("/:workspace/widget/config.json", async (c, next) => {
        await next();
        if (!c.res.headers.has("Access-Control-Allow-Origin"))
          c.res.headers.set("Access-Control-Allow-Origin", "*");
        if (!c.res.headers.has("Cross-Origin-Resource-Policy"))
          c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      })
      .get("/:workspace/widget", (c) => {
        const script = asset("host.js");
        const style = asset("host.css");
        if (!script || !style) return unbuilt(c);
        const etag = `"${script.version}-${style.version}"`;
        c.header("Content-Security-Policy", PAGE_POLICY);
        c.header("Cache-Control", "no-cache");
        c.header("ETag", etag);
        c.header("X-Content-Type-Options", "nosniff");
        c.header("Cross-Origin-Resource-Policy", "cross-origin");
        if (matchesEtag(c, etag)) return c.body(null, 304);
        return c.html(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Support</title><link rel="stylesheet" href="widget/host.css?v=${style.version}"><script src="widget/host.js?v=${script.version}" defer></script></head><body><div id="root"></div></body></html>`,
        );
      })
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
  );
}

export default widgetHost(() => findWidgetDist());
