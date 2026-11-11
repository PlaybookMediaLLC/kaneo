import { createHash } from "node:crypto";
import { destinationFetch } from "../../import/destination-fetch";
import { createGuardedFetch } from "../../import/guarded-fetch";
import { withoutOutboundTelemetry } from "../../utils/sensitive-outbound";
import { createUpload, verifyUpload } from "../framework/files";

export { companyEmailDomain } from "../../database/quills/email/personal-email-domains";

// Trusted for the website-branding route module: no database access and no event delivery.
// It reads an untrusted website through Kaneo's public-destination guard and writes the chosen logo to
// object storage under the shared verification lease. framework/boundaries.test.ts allows this module.

/** Only the head is parsed, so the page read stops here. */
const PAGE_BYTES = 200 * 1024;
const IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
/** All image fetches of one lookup share this time. */
const IMAGE_BUDGET_MS = 25_000;
const MAX_IMAGES = 5;
const MAX_ICONS = 12;
/** A larger image is refused, not offered as a logo. */
const MAX_SIDE = 4096;
/** A good logo is at least this large on its shorter side. */
const GOOD_SIDE = 64;
/** Touch icons are published at 180 px when no size is declared. */
const TOUCH_SIZE = 180;
const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Website fetches use only the standard web ports and never carry credentials. */
const isStandardWebsiteUrl = (url: URL) =>
  (url.protocol === "https:" || url.protocol === "http:") &&
  (url.port === "" || url.port === "80" || url.port === "443") &&
  !url.username &&
  !url.password;

/** A website typed as a domain or a URL, or null when it cannot be fetched for branding. */
export function parseWebsiteInput(site: string): URL | null {
  const value = site.trim();
  if (!value) return null;
  try {
    // `host:443` is a host and port; `name:` followed by anything else is a scheme.
    const url = new URL(
      /^[a-z][a-z\d+.-]*:(?!\d)/i.test(value) ? value : `https://${value}`,
    );
    return isStandardWebsiteUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** One GET through the guard. Every hop must also use a standard port. Returns the last hop's URL. */
async function guardedGet(url: string, accept: string, timeoutMs: number) {
  let final = url;
  const guard = createGuardedFetch("Website", {
    baseFetch: (hop, init) => {
      if (!isStandardWebsiteUrl(new URL(hop)))
        return Promise.reject(new Error("Website URL is not allowed"));
      final = hop;
      return destinationFetch(hop, init);
    },
  });
  const response = await guard.fetch(url, {
    headers: { accept },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, url: final };
}

/** At most `max` bytes. `truncate`: keep the first `max` bytes; otherwise a larger body is null. */
async function readCapped(response: Response, max: number, truncate = false) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        if (!truncate) return null;
        chunks.push(value.subarray(0, value.byteLength - (size - max)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
/** One pass, so a decoded character is never decoded again. */
const decode = (text: string) =>
  text.replace(
    /&(?:([a-z]+)|#x([0-9a-f]{1,6})|#(\d{1,7}));/gi,
    (all, name?: string, hex?: string, dec?: string) => {
      if (name) return entities[name.toLowerCase()] ?? all;
      const point = hex ? Number.parseInt(hex, 16) : Number(dec);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    },
  );

/** One attribute of a tag: double, single or no quotes. */
function attribute(tag: string, name: string) {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  ).exec(tag);
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? "").trim() : null;
}

/** An http(s) URL resolved against the page, or null. */
function resolve(href: string | null, base: string) {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.href.length <= 2048
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** `#RGB` or `#RRGGBB` as `#RRGGBB`, or null. */
function hexColor(value: string) {
  const color = value.trim();
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(color))
    return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`.toUpperCase();
  return null;
}

/**
 * A theme color that can carry white text (3:1 contrast) and reads as a brand, not as black, grey
 * or slate (OKLCH chroma of at least 0.05). Null otherwise.
 */
export function brandColor(value: string | null) {
  const hex = value && hexColor(value);
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (1.05 / (luminance + 0.05) < 3) return null;
  // Linear sRGB to OKLab (Björn Ottosson); chroma is the length of (a, b).
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const chroma = Math.hypot(
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
  return chroma >= 0.05 ? hex : null;
}

type Candidate = { url: string; source: "icon" | "social"; rank: number };

/** Lower ranks are fetched first; null: never fetched (SVG and ICO). */
function iconRank(url: string, size: number | null, type: string | null) {
  const extension = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1];
  const ext = extension?.toLowerCase() ?? "";
  if (
    type?.includes("svg") ||
    type?.includes("icon") ||
    ext === "svg" ||
    ext === "ico"
  )
    return null;
  const pngOrWebp =
    type === "image/png" ||
    type === "image/webp" ||
    ext === "png" ||
    ext === "webp";
  // A large PNG or WebP first, larger before smaller.
  if (size !== null && size >= 128 && (pngOrWebp || (!type && ext === "")))
    return 1 - Math.min(size, MAX_SIDE) / (MAX_SIDE + 1);
  if (size !== null && size >= GOOD_SIDE) return 2;
  return size === null ? 3 : 4;
}

/**
 * The logo candidates of a page's head, in fetch order and at most MAX_IMAGES, and its theme color.
 * Linear patterns over at most PAGE_BYTES: a hostile page must not hold the event loop.
 */
export function readHead(html: string, base: string) {
  const end = html.search(/<\/head\s*>/i);
  const head = end === -1 ? html : html.slice(0, end);
  const candidates: Candidate[] = [];
  let social: string | null = null;
  let twitter: string | null = null;
  let color: string | null = null;
  let colorPriority = 0;
  for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    const property = attribute(tag, "property")?.toLowerCase();
    const name = attribute(tag, "name")?.toLowerCase();
    const content = attribute(tag, "content");
    if (content === null) continue;
    if (property === "og:image") social ??= resolve(content, base);
    else if (name === "twitter:image") twitter ??= resolve(content, base);
    else if (name === "theme-color") {
      // A color with no media query wins over the light-scheme one; a dark-scheme one never counts.
      const media = attribute(tag, "media")?.toLowerCase() ?? "";
      const priority = !media
        ? 2
        : /^\(\s*prefers-color-scheme\s*:\s*light\s*\)$/.test(media)
          ? 1
          : 0;
      const hex = hexColor(content);
      if (hex && priority > colorPriority) {
        color = hex;
        colorPriority = priority;
      }
    }
  }
  let icons = 0;
  for (const [tag] of head.matchAll(/<link\s[^>]*>/gi)) {
    if (icons >= MAX_ICONS) break;
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const touch =
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed");
    if (!touch && !rel.includes("icon")) continue;
    const url = resolve(attribute(tag, "href"), base);
    if (!url) continue;
    icons++;
    const sides = (attribute(tag, "sizes") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .flatMap((entry) => {
        const match = /^(\d{1,5})x(\d{1,5})$/.exec(entry);
        return match ? [Math.min(Number(match[1]), Number(match[2]))] : [];
      });
    const size = sides.length ? Math.max(...sides) : touch ? TOUCH_SIZE : null;
    const rank = iconRank(
      url,
      size,
      attribute(tag, "type")?.toLowerCase() || null,
    );
    if (rank !== null) candidates.push({ url, source: "icon", rank });
  }
  candidates.push({
    url: new URL("/apple-touch-icon.png", base).href,
    source: "icon",
    rank: 2.5,
  });
  const image = social ?? twitter;
  if (image) candidates.push({ url: image, source: "social", rank: 6 });
  const seen = new Set<string>();
  return {
    color: brandColor(color),
    candidates: candidates
      .sort((a, b) => a.rank - b.rank)
      .filter((one) => !seen.has(one.url) && Boolean(seen.add(one.url)))
      .slice(0, MAX_IMAGES),
  };
}

const sized = (width: number, height: number) =>
  width > 0 && height > 0 ? { width, height } : null;

/** The pixel size from the image's own header, or null when the bytes are not that image type. */
export function imageSize(buf: Buffer, type: string) {
  if (type === "image/png")
    return buf.length >= 24 &&
      buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      buf.toString("ascii", 12, 16) === "IHDR"
      ? sized(buf.readUInt32BE(16), buf.readUInt32BE(20))
      : null;
  if (type === "image/gif")
    return buf.length >= 10 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))
      ? sized(buf.readUInt16LE(6), buf.readUInt16LE(8))
      : null;
  if (type === "image/webp") {
    if (
      buf.length < 30 ||
      buf.toString("ascii", 0, 4) !== "RIFF" ||
      buf.toString("ascii", 8, 12) !== "WEBP"
    )
      return null;
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ")
      return buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a
        ? sized(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
        : null;
    if (chunk === "VP8L") {
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    return chunk === "VP8X"
      ? sized(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1)
      : null;
  }
  if (type === "image/jpeg") {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    // Walk the segments to the first frame header (SOF), which holds the size.
    for (let offset = 2; offset + 9 <= buf.length;) {
      if (buf[offset] !== 0xff) return null;
      const marker = buf[offset + 1]!;
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return sized(
          buf.readUInt16BE(offset + 7),
          buf.readUInt16BE(offset + 5),
        );
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

/** An image of an accepted type, at most IMAGE_BYTES, whose bytes match its declared type. */
async function fetchImage(url: string, timeoutMs: number) {
  const { response } = await guardedGet(
    url,
    Object.keys(extensions).join(","),
    timeoutMs,
  );
  const type = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase()
    .replace(/^image\/jpg$/, "image/jpeg");
  if (
    !response.ok ||
    !extensions[type] ||
    Number(response.headers.get("content-length")) > IMAGE_BYTES
  ) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await readCapped(response, IMAGE_BYTES);
  const size = bytes && imageSize(bytes, type);
  return size ? { bytes: bytes!, contentType: type, ...size } : null;
}

export type WebsiteLogo = {
  bytes: Buffer;
  contentType: string;
  color: string | null;
};

/**
 * Reads the site's home page and its best logo. The first good candidate wins (an icon of at least
 * 64 px on each side); otherwise the first usable one. Null when the page or every image fails.
 * Every failure, a refused destination too, is null: the site is untrusted input.
 */
export async function fetchWebsiteBranding(
  site: URL,
): Promise<WebsiteLogo | null> {
  try {
    const page = await guardedGet(
      new URL("/", site).href,
      "text/html",
      TIMEOUT_MS,
    );
    if (
      !page.response.ok ||
      !/^text\/html/i.test(page.response.headers.get("content-type") ?? "")
    ) {
      void page.response.body?.cancel().catch(() => {});
      return null;
    }
    const html = (await readCapped(page.response, PAGE_BYTES, true))!;
    const { color, candidates } = readHead(html.toString("utf8"), page.url);
    const deadline = Date.now() + IMAGE_BUDGET_MS;
    let usable: Awaited<ReturnType<typeof fetchImage>> = null;
    for (const candidate of candidates) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const image = await fetchImage(
        candidate.url,
        Math.min(TIMEOUT_MS, left),
      ).catch(() => null);
      if (!image || image.width > MAX_SIDE || image.height > MAX_SIDE) continue;
      if (
        candidate.source === "icon" &&
        Math.min(image.width, image.height) >= GOOD_SIDE
      )
        return { bytes: image.bytes, contentType: image.contentType, color };
      usable ??= image;
    }
    return (
      usable && {
        bytes: usable.bytes,
        contentType: usable.contentType,
        color,
      }
    );
  } catch {
    return null;
  }
}

/**
 * Writes the logo under a new key of this workspace's logo namespace, then verifies it under the
 * shared verification lease. The route's handler must call holdVerifiedUpload before it writes the
 * reference.
 */
export async function storeLogo(workspaceId: string, logo: WebsiteLogo) {
  const size = logo.bytes.length;
  const upload = await createUpload(workspaceId, {
    purpose: "logo",
    filename: `logo.${extensions[logo.contentType]}`,
    contentType: logo.contentType,
    size,
  });
  // The URL carries a signature: keep it out of HTTP telemetry.
  const put = await withoutOutboundTelemetry(() =>
    fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: new Uint8Array(logo.bytes),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  void put.body?.cancel().catch(() => {});
  if (!put.ok) throw new Error(`Object storage answered ${put.status}`);
  const verified = await verifyUpload(workspaceId, ["logo"], {
    key: upload.key,
    contentType: logo.contentType,
    size,
  });
  return {
    ...verified,
    sha256: createHash("sha256").update(logo.bytes).digest("hex"),
  };
}
