import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { requireSurface, type Customer } from "./customer/model";
import { fetchHtmlPage } from "./link-fetch";

// Link previews (unfurl) for message composers: the title, description and site name of a web
// page. The page is fetched in `call`, with no transaction open, through support/link-fetch.ts.
// Every failure answers { preview: null } with no error text from the page or the network. There
// is no cache: the contract forbids a read to write rows. Customer routes have a rate limit.

const MAX_SCAN = 200 * 1024;
const MAX_VALUE = 2000;

const previewSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
});
type Preview = z.output<typeof previewSchema>;
const response = z.object({ preview: previewSchema.nullable() });
const query = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2048),
});

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** One pass over a short value: named, decimal and hex references; a produced "&" is never read again. */
const decode = (text: string) =>
  text.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi,
    (all, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? all;
      const point = Number.parseInt(
        code.slice(code[1] === "x" || code[1] === "X" ? 2 : 1),
        code[1] === "x" || code[1] === "X" ? 16 : 10,
      );
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    },
  );
/** Decoded, without control characters, on one line, at most `max` characters; null when empty. */
const clean = (raw: string | undefined, max: number) => {
  if (raw === undefined) return null;
  const text = decode(raw.slice(0, MAX_VALUE))
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
};
const SPACE = /\s/;

/**
 * The attributes of one tag, read left to right in a single pass. No regular expression runs over
 * the tag, so a hostile tag of any length costs linear time.
 */
function attributes(tag: string) {
  const found = new Map<string, string>();
  let i = 0;
  while (i < tag.length) {
    while (i < tag.length && (SPACE.test(tag[i]!) || tag[i] === "/")) i++;
    const start = i;
    while (i < tag.length && !SPACE.test(tag[i]!) && tag[i] !== "=") i++;
    const name = tag.slice(start, i).toLowerCase();
    while (i < tag.length && SPACE.test(tag[i]!)) i++;
    let value = "";
    if (tag[i] === "=") {
      i++;
      while (i < tag.length && SPACE.test(tag[i]!)) i++;
      const quote = tag[i];
      if (quote === '"' || quote === "'") {
        const close = tag.indexOf(quote, i + 1);
        const end = close === -1 ? tag.length : close;
        value = tag.slice(i + 1, end);
        i = end + 1;
      } else {
        const begin = i;
        while (i < tag.length && !SPACE.test(tag[i]!)) i++;
        value = tag.slice(begin, i);
      }
    }
    if (name && !found.has(name)) found.set(name, value);
  }
  return found;
}

/**
 * The preview fields of an HTML page, from the first 200 KB of its head: OpenGraph, then Twitter,
 * then the title and description tags. Linear time in the page length: each search starts where
 * the previous one stopped, and a tag with no closing ">" ends the scan.
 */
export function parsePreview(html: string, url: string): Preview | null {
  const scoped = html.slice(0, MAX_SCAN);
  const headEnd = scoped.search(/<\/head\b/i);
  const head = headEnd === -1 ? scoped : scoped.slice(0, headEnd);
  const meta = new Map<string, string>();
  let title: string | undefined;
  const tag = /<(meta|title)\b/gi;
  for (let match = tag.exec(head); match; match = tag.exec(head)) {
    const end = head.indexOf(">", tag.lastIndex);
    if (end === -1) break;
    tag.lastIndex = end + 1;
    if (match[1]!.toLowerCase() === "title") {
      if (title !== undefined) continue;
      const close = /<\/title\b/gi;
      close.lastIndex = end + 1;
      const closing = close.exec(head);
      title = closing ? head.slice(end + 1, closing.index) : "";
      if (closing) tag.lastIndex = closing.index;
      continue;
    }
    const attrs = attributes(head.slice(match.index + 5, end));
    const key = (attrs.get("property") || attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const preview = {
    url,
    title: clean(
      meta.get("og:title") || meta.get("twitter:title") || title,
      200,
    ),
    description: clean(
      meta.get("og:description") ||
        meta.get("twitter:description") ||
        meta.get("description"),
      500,
    ),
    siteName: clean(meta.get("og:site_name"), 100),
  };
  return preview.title || preview.description ? preview : null;
}

/** The fetch and parse. Runs in `call`, with no transaction open. */
async function unfurl(url: string, strict: boolean) {
  const page = await fetchHtmlPage(url, { strict });
  return page && parsePreview(page.html, page.url);
}
const description =
  "A private, loopback, link-local or metadata address, a redirect to one, more than 3 redirects, more than 5 seconds, a body that is not HTML, more than 2 previews at once in the API process, or any failure answers preview: null.";

const teammate = defineQuillsRoute({
  method: "get",
  path: "/support/link-preview",
  operationId: "unfurlQuillsLink",
  summary: "Get a link preview for a web page",
  description: `${description} The instance switch KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS lets teammates preview private addresses, as for imports and webhooks.`,
  action: "read",
  query,
  response,
  responseDescription: "The preview, or null",
  // The permission checks run first; the fetch waits until no transaction holds a connection.
  prepare: async () => undefined,
  call: (_prepared, { query }) => unfurl(query.url, false),
  handler: async ({ called }) => ({ preview: called }),
});

/** The customer twin: the composer of the portal support pages or of the widget messenger. */
const customer = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    method: "get",
    path: `${audience === "widget" ? "/widget" : "/support"}/link-preview`,
    operationId:
      audience === "widget"
        ? "unfurlQuillsWidgetLink"
        : "unfurlQuillsPortalLink",
    summary: "Get a link preview for a web page",
    description: `${description} Needs the ${audience === "widget" ? "widget and its messenger" : "portal and its support pages"}. At most 30 requests a minute for each client address. A private address is always refused here, also when the instance allows private destinations.`,
    action: "read",
    rateLimit: { limit: 30, windowSeconds: 60 },
    query,
    response,
    responseDescription: "The preview, or null",
    errors: { 404: "Support surface not found" },
    prepare: ({ db, caller }) =>
      requireSurface(db, audience, caller, "messenger"),
    call: (_prepared, { query }) => unfurl(query.url, true),
    handler: async ({ called }) => ({ preview: called }),
  });

/** Teammate route. */
export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...teammate,
);

/** Customer routes under /quills-public/{workspace}. */
export const customerLinkPreview = (audience: Customer) =>
  apiRouter().openapi(...customer(audience));
