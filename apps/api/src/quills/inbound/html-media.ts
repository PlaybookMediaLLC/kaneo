export interface ExtractedDataImage {
  placeholder: string;
  contentType: string;
  bytes: Uint8Array;
  filename: string;
}

const ALLOWED_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_DATA_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_IMAGES = 10;

const ALLOWED_INBOUND_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const VOID_INBOUND_TAGS = new Set(["br", "hr", "img"]);
const ALLOWED_INBOUND_ATTRS = new Set(["href", "src", "alt", "title"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : "";
    })
    .replace(/&#(\d+);?/g, (_m, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : "";
    })
    .replace(/&colon;/gi, ":")
    .replace(/&amp;/gi, "&");
}

function compactLower(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) out += value[i]!.toLowerCase();
  }
  return out;
}

/**
 * Strict allowlist HTML sanitizer for inbound email HTML (#326).
 * Preserves safe formatting tags and `<img>` with `https:`, `cid:`, or `quills-file://` sources.
 */
export function sanitizeInboundHtml(html: string): string {
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
  const blocked =
    /<\s*(script|style|iframe|object|embed|svg|math|form|template|textarea|title|noscript)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;
  for (let pass = 0; pass < 5; pass++) {
    const next = cleaned.replace(blocked, "");
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g,
    (_full, slash: string, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_INBOUND_TAGS.has(tag)) return "";
      if (slash === "/") return VOID_INBOUND_TAGS.has(tag) ? "" : `</${tag}>`;
      const attrs: string[] = [];
      const attrRe =
        /(?:^|[\s/])([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`/]+)))?/g;
      let match: RegExpExecArray | null;
      while ((match = attrRe.exec(rawAttrs)) !== null) {
        const name = match[1]?.toLowerCase();
        if (!name || !ALLOWED_INBOUND_ATTRS.has(name)) continue;
        const val = match[2] ?? match[3] ?? match[4] ?? "";
        if (name === "href") {
          if (tag !== "a") continue;
          const norm = compactLower(decodeEntities(val));
          if (
            !norm.startsWith("https://") &&
            !norm.startsWith("http://") &&
            !norm.startsWith("mailto:")
          ) {
            continue;
          }
          attrs.push(`href="${escapeHtml(val.trim())}"`);
        } else if (name === "src") {
          if (tag !== "img") continue;
          const trimmed = val.trim();
          const norm = compactLower(decodeEntities(trimmed));
          if (
            !norm.startsWith("https://") &&
            !norm.startsWith("http://") &&
            !norm.startsWith("cid:") &&
            !norm.startsWith("quills-file://") &&
            !trimmed.startsWith("__QUILLS_INLINE_IMG_")
          ) {
            continue;
          }
          attrs.push(`src="${escapeHtml(trimmed)}"`);
        } else {
          attrs.push(`${name}="${escapeHtml(val)}"`);
        }
      }
      const attrStr = attrs.length ? ` ${attrs.join(" ")}` : "";
      return VOID_INBOUND_TAGS.has(tag)
        ? `<${tag}${attrStr} />`
        : `<${tag}${attrStr}>`;
    },
  );
}

/**
 * Extracts `data:image/...;base64,...` images from HTML or Markdown/plain text,
 * replacing them with deterministic placeholders that callers swap to `quills-file://<id>`
 * after uploading bytes to object storage.
 */
export function extractDataUriImages(input: string): {
  text: string;
  images: ExtractedDataImage[];
} {
  const images: ExtractedDataImage[] = [];
  const dataUriRe =
    /data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]{8,})/gi;
  const text = input.replace(
    dataUriRe,
    (full, rawMime: string, rawB64: string) => {
      if (images.length >= MAX_DATA_IMAGES) return full;
      const mime =
        rawMime.toLowerCase() === "image/jpg"
          ? "image/jpeg"
          : rawMime.toLowerCase();
      const ext = ALLOWED_IMAGE_MIME[mime];
      if (!ext) return full;
      const compact = rawB64.replace(/\s+/g, "");
      const decoded = Buffer.from(compact, "base64");
      if (
        decoded.byteLength === 0 ||
        decoded.byteLength > MAX_DATA_IMAGE_BYTES
      ) {
        return full;
      }
      const index = images.length;
      const placeholder = `__QUILLS_INLINE_IMG_${index}__`;
      images.push({
        placeholder,
        contentType: mime,
        bytes: new Uint8Array(decoded),
        filename: `inline-image-${index + 1}.${ext}`,
      });
      return placeholder;
    },
  );
  return { text, images };
}

/** Normalize a MIME Content-ID header (`<abc@host>` -> `abc@host`, lowercased). */
export function normalizeContentId(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/^<+|>+$/g, "")
    .trim()
    .toLowerCase();
  return cleaned || null;
}

/**
 * Rewrites `<img src="cid:...">` references in sanitized inbound HTML to
 * `quills-file://<fileId>` references using a map from normalized Content-ID -> fileId.
 */
export function rewriteCidToQuillsFiles(
  html: string,
  cidToFileId: ReadonlyMap<string, string>,
): { html: string; matchedFileIds: string[] } {
  const matched = new Set<string>();
  const rewritten = html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])cid:([^"']+)\2/gi,
    (full, prefix: string, quote: string, rawCid: string) => {
      let decoded = rawCid;
      try {
        decoded = decodeURIComponent(rawCid);
      } catch {
        decoded = rawCid;
      }
      const normalized = normalizeContentId(decoded);
      const fileId = normalized ? cidToFileId.get(normalized) : undefined;
      if (!fileId) return full;
      matched.add(fileId);
      return `${prefix}${quote}quills-file://${fileId}${quote}`;
    },
  );
  return { html: rewritten, matchedFileIds: [...matched] };
}

/**
 * Extracts markdown image references `![alt](quills-file://<fileId>)` and converts
 * a plain-text/markdown agent reply plus inline attachments into clean email-ready HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface OutboundInlineImage {
  fileId: string;
  filename: string;
  src: string;
}

/**
 * Renders a message's plain text and inline image references into safe HTML for
 * outbound email clients (Gmail, Outlook, Apple Mail). Inline images referenced via
 * `![alt](quills-file://<id>)` render in place; any additional inline images not
 * explicitly referenced in the text are appended neatly below the message body.
 */
export function renderOutboundMessageHtml(
  text: string,
  inlineImages: readonly OutboundInlineImage[],
): string {
  const byId = new Map(inlineImages.map((img) => [img.fileId, img]));
  const used = new Set<string>();
  const imgTag = (src: string, alt: string) =>
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:6px;display:block;margin:8px 0;" />`;

  const markdownImgRe = /!\[([^\]]*)\]\(quills-file:\/\/([a-z0-9_]+)\)/gi;
  const paragraphs = text.split(/\n{2,}/).map((para) => {
    let result = "";
    let lastIndex = 0;
    for (const match of para.matchAll(markdownImgRe)) {
      const start = match.index ?? 0;
      if (start > lastIndex) {
        result += escapeHtml(para.slice(lastIndex, start)).replace(
          /\n/g,
          "<br />",
        );
      }
      const alt = match[1] || "image";
      const fileId = match[2]!;
      const img = byId.get(fileId);
      if (img) {
        used.add(fileId);
        result += imgTag(img.src, alt || img.filename);
      } else {
        result += escapeHtml(match[0]);
      }
      lastIndex = start + match[0].length;
    }
    if (lastIndex < para.length) {
      result += escapeHtml(para.slice(lastIndex)).replace(/\n/g, "<br />");
    }
    return `<p style="margin:0 0 12px 0;">${result}</p>`;
  });

  for (const img of inlineImages) {
    if (!used.has(img.fileId)) {
      paragraphs.push(imgTag(img.src, img.filename));
    }
  }
  return paragraphs.join("");
}
