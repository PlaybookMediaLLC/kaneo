import { and, eq, gt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import {
  pageViews,
  visitorDevices,
} from "../../database/quills/schema/visitor-analytics";
import { hashToken } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { bool, parseJson } from "../settings/area";

// The anonymous page-view beacon for portal and widget visitor analytics (the source's
// routes/api/track.ts). Raw IP and User-Agent are used only for the bot filter, the device fields
// and the daily-salted visitor hash; neither is stored with a view. visitor-rollup.ts reads the rows.

/** A salt lives for its own UTC day and the next one; then that day's hashes cannot be linked. */
const SALT_TTL_MS = 48 * 60 * 60 * 1000;
const salts = new Map<string, string>();

/** The workspace's salt for a UTC day. The first writer wins across instances. */
async function dailySalt(db: Database, workspaceId: string, day: string) {
  const cached = salts.get(`${workspaceId}:${day}`);
  if (cached) return cached;
  const key = `visitor:salt:${day}`;
  const inserted = await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key,
      value: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "hex",
      ),
      expiresAt: new Date(Date.parse(day) + SALT_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ key: kvStore.key });
  const [row] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, key),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    );
  if (typeof row?.value !== "string") return null;
  // A salt this transaction wrote is cached only once a later request reads it committed.
  if (inserted.length) return row.value;
  for (const cachedKey of salts.keys())
    if (!cachedKey.endsWith(day)) salts.delete(cachedKey);
  salts.set(`${workspaceId}:${day}`, row.value);
  return row.value;
}

// ponytail: a short pattern list instead of the source's isbot and Bowser (not installed here).
// Add a parser package if the device, browser or OS breakdowns need more precision.
const BOT =
  /bot|crawl|spider|slurp|archiver|headless|lighthouse|pingdom|monitor|preview|facebookexternalhit|curl|wget|python|httpclient|okhttp|go-http|java\//i;
const first = (ua: string, names: [RegExp, string][]) =>
  names.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
const describeAgent = (ua: string) => ({
  // Separate tests: a lookahead after "android" would scan the rest of the string for each match.
  device:
    /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))
      ? "tablet"
      : /mobi|iphone|ipod|android/i.test(ua)
        ? "mobile"
        : "desktop",
  browser: first(ua, [
    [/edg(e|a|ios)?\//i, "Microsoft Edge"],
    [/opr\/|opera/i, "Opera"],
    [/samsungbrowser/i, "Samsung Internet for Android"],
    [/firefox|fxios/i, "Firefox"],
    [/chrome|crios|chromium/i, "Chrome"],
    [/safari/i, "Safari"],
  ]),
  os: first(ua, [
    [/windows/i, "Windows"],
    [/iphone|ipad|ipod/i, "iOS"],
    [/android/i, "Android"],
    [/cros/i, "Chrome OS"],
    [/mac os x|macintosh/i, "macOS"],
    [/linux/i, "Linux"],
  ]),
});

/**
 * Campaign parameters win, then the external referrer's host name. A same-origin referrer is
 * internal navigation (direct). The query string is read here and never stored.
 */
function deriveSource(url: URL, referrer: string) {
  const campaign =
    url.searchParams.get("utm_source") ??
    url.searchParams.get("source") ??
    url.searchParams.get("ref");
  if (campaign) return campaign.slice(0, 100);
  try {
    const ref = new URL(referrer);
    return ref.hostname === url.hostname ? null : ref.hostname;
  } catch {
    return null;
  }
}

const track = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/track",
  operationId: "createQuillsTrack",
  summary: "Record a portal or widget page view",
  description:
    "Anonymous beacon. The body may be sent as text/plain (sendBeacon). 404 while the surface (portal or widget) is off. Do Not Track, Global Privacy Control, a bot, a widget with visitor analytics off, a URL that is not http(s) and a day with no page-view partition store nothing; the answer is the same. Only the page's origin and path, the referrer's host, the CDN country, coarse device fields and a daily-salted visitor hash are stored with the view. As in the source, the rate limit counts per client IP in rate_bucket until retention removes the expired window.",
  action: "create",
  textBody: true,
  rateLimit: { limit: 120, windowSeconds: 60 },
  body: z.object({
    url: z.string().max(2000),
    referrer: z.string().max(2000).optional(),
    surface: z.enum(["portal", "widget"]),
    // The source's deviceId. Named as in POST /widget/device: a caller-chosen value, not a reference.
    device: z.string().min(1).max(128).optional(),
  }),
  response: z.object({}),
  responseDescription: "Accepted",
  event: { none: "Visitor analytics only; no record of a person changes" },
  handler: async ({ db, body, request, workspaceId }) => {
    const [row] = await db
      .select({
        portalConfig: settings.portalConfig,
        widgetConfig: settings.widgetConfig,
      })
      .from(settings)
      .limit(1);
    const widget = parseJson(row?.widgetConfig ?? null);
    const fromWidget = body.surface === "widget";
    // A surface that is off counts nothing: 404, as its other routes answer.
    const surface = fromWidget ? widget : parseJson(row?.portalConfig ?? null);
    if (surface.enabled !== true)
      throw new HTTPException(404, {
        message: fromWidget ? "Widget not found" : "Portal not found",
      });
    const ua = request.userAgent;
    if (request.doNotTrack || !ua || BOT.test(ua)) return {};
    if (fromWidget && !bool(widget.visitorAnalytics, true)) return {};
    let url: URL;
    try {
      url = new URL(body.url);
    } catch {
      return {};
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return {};
    const deviceId =
      body.device && (!fromWidget || bool(widget.visitorDeviceTracking, true))
        ? body.device
        : null;
    // Only an existing day partition takes the row: this route never creates one, and a day
    // outside the maintained window stores nothing.
    const occurredAt = new Date();
    const day = occurredAt.toISOString().slice(0, 10);
    const partition = await db.execute<{ ok: boolean }>(
      sql`select to_regclass(${`quills.page_views_${day.replaceAll("-", "")}`}) is not null as ok`,
    );
    if (!partition.rows[0]?.ok) return {};
    const salt = await dailySalt(db, workspaceId, day);
    if (!salt) return {};
    await db.insert(pageViews).values({
      occurredAt,
      siteOrigin: url.origin,
      surface: body.surface,
      path: url.pathname,
      source: deriveSource(url, body.referrer ?? ""),
      country: request.country,
      ...describeAgent(ua),
      visitorHash: hashToken(
        `${salt}\u0000${url.origin}\u0000${request.ip ?? "unknown"}\u0000${ua}`,
      ),
      deviceId,
    });
    // Only a device that a widget session linked (POST /widget/device) is touched. Unlike the
    // source, an anonymous beacon creates no device row: nothing would ever remove one.
    if (deviceId)
      await db
        .update(visitorDevices)
        .set({
          lastSeenAt: sql`now()`,
          lastCountry: sql`coalesce(${request.country}, ${visitorDevices.lastCountry})`,
        })
        .where(eq(visitorDevices.deviceId, deviceId));
    return {};
  },
});

export default apiRouter().openapi(...track);
