/**
 * Multi-brand visual block & sanitized HTML email renderer (#332).
 *
 * The exact same pure `renderBrandedEmail()` function powers:
 * - Live editor previews (`POST /settings/email-templates/preview`)
 * - Send Test emails (`POST /settings/email-templates/send-test`)
 * - Branded outbound sends
 * so preview HTML and sent HTML are guaranteed identical byte-for-byte.
 */

export interface BrandStyleInput {
  name: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  footerText?: string | null;
  hidePoweredBy?: boolean;
}

export interface EmailBlock {
  id: string;
  type: "header" | "text" | "button" | "divider" | "footer";
  content?: string;
  label?: string;
  url?: string;
  align?: "left" | "center" | "right";
}

export interface RenderBrandedEmailInput {
  brand: BrandStyleInput;
  subject: string;
  mode: "blocks" | "html";
  blocks?: readonly EmailBlock[];
  htmlBody?: string | null;
  variables?: Record<string, string>;
}

export interface RenderedBrandedEmail {
  subject: string;
  html: string;
  text: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function safeColor(color: string | null | undefined, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : fallback;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(url: string | undefined): string {
  if (!url) return "#";
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "#";
}

/** Replaces `{{key}}` placeholders with HTML-escaped variable values. */
export function interpolateVariables(
  template: string,
  variables: Record<string, string>,
  escape: boolean,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const val = variables[key] ?? "";
    return escape ? escapeHtml(val) : val;
  });
}

function safeImageUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return escapeHtml(trimmed);
  return "";
}

function decodeHtmlEntities(input: string): string {
  return input
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
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripControlAndWhitespace(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) out += input[i];
  }
  return out;
}

const ALLOWED_EMAIL_TAGS = new Set([
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
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const VOID_EMAIL_TAGS = new Set(["br", "hr", "img"]);

const ALLOWED_EMAIL_ATTRS = new Set([
  "align",
  "alt",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "class",
  "colspan",
  "height",
  "href",
  "role",
  "rowspan",
  "src",
  "style",
  "title",
  "valign",
  "width",
]);

function sanitizeInlineStyle(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  // Reject CSS backslash escapes (e.g. \75\72\6c) which can obfuscate url()/expression().
  if (decoded.includes("\\")) return "";
  // Strip CSS comments (/*...*/) before inspecting for dangerous functions.
  const withoutComments = decoded.replace(/\/\*[\s\S]*?\*\//g, "");
  const lower = stripControlAndWhitespace(withoutComments).toLowerCase();
  if (
    lower.includes("expression(") ||
    lower.includes("javascript:") ||
    lower.includes("vbscript:") ||
    lower.includes("url(") ||
    lower.includes("@import") ||
    lower.includes("behavior:") ||
    lower.includes("-moz-binding")
  ) {
    return "";
  }
  return escapeHtml(decoded.replace(/[<>]/g, ""));
}

function sanitizeAttribute(
  tag: string,
  name: string,
  value: string,
): string | null {
  const attr = name.toLowerCase();
  if (!ALLOWED_EMAIL_ATTRS.has(attr) || attr.startsWith("on")) return null;
  const decoded = decodeHtmlEntities(value);
  if (attr === "href") {
    if (tag !== "a") return null;
    const normalized = stripControlAndWhitespace(decoded).toLowerCase();
    if (
      !normalized.startsWith("https://") &&
      !normalized.startsWith("http://") &&
      !normalized.startsWith("mailto:")
    ) {
      return 'href="#"';
    }
    return `href="${escapeHtml(decoded.trim())}"`;
  }
  if (attr === "src") {
    if (tag !== "img") return null;
    const normalized = stripControlAndWhitespace(decoded).toLowerCase();
    if (
      !normalized.startsWith("https://") &&
      !normalized.startsWith("http://")
    ) {
      return null;
    }
    return `src="${escapeHtml(decoded.trim())}"`;
  }
  if (attr === "style") {
    const clean = sanitizeInlineStyle(value);
    return clean ? `style="${clean}"` : null;
  }
  return `${attr}="${escapeHtml(decoded)}"`;
}

/**
 * Strict allowlist HTML sanitizer for custom email templates (#332).
 * Strips dangerous paired tags (`script`, `style`, `svg`, `iframe`, `object`, `embed`, `form`, etc.),
 * drops all non-allowlisted tags and `on*` handlers, and entity-decodes URLs before scheme checks.
 */
export function sanitizeEmailTemplateHtml(raw: string): string {
  // Iteratively strip dangerous paired containers so nested tags like <scr<script>ipt> cannot reassemble.
  let cleaned = raw;
  const blockedBlock =
    /<(script|style|iframe|object|embed|applet|svg|math|template|textarea|title|noscript|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  for (let pass = 0; pass < 5; pass++) {
    const next = cleaned.replace(blockedBlock, "");
    if (next === cleaned) break;
    cleaned = next;
  }
  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  // Tokenize tags and rebuild only allowlisted tags & attributes.
  return cleaned.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g,
    (_full, slash: string, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_EMAIL_TAGS.has(tag)) return "";
      if (slash === "/") {
        return VOID_EMAIL_TAGS.has(tag) ? "" : `</${tag}>`;
      }
      const attrs: string[] = [];
      const attrRe =
        /(?:^|[\s/])([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`/]+)))?/g;
      let match: RegExpExecArray | null;
      while ((match = attrRe.exec(rawAttrs)) !== null) {
        const attrName = match[1];
        if (!attrName) continue;
        const attrValue = match[2] ?? match[3] ?? match[4] ?? "";
        const sanitized = sanitizeAttribute(tag, attrName, attrValue);
        if (sanitized) attrs.push(sanitized);
      }
      const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
      return VOID_EMAIL_TAGS.has(tag)
        ? `<${tag}${attrStr} />`
        : `<${tag}${attrStr}>`;
    },
  );
}

function renderBlock(
  block: EmailBlock,
  brand: {
    name: string;
    primary: string;
    accent: string;
    logoUrl?: string | null;
    darkLogoUrl?: string | null;
  },
  variables: Record<string, string>,
): { html: string; text: string } {
  const align =
    block.align === "center" || block.align === "right" ? block.align : "left";

  switch (block.type) {
    case "header": {
      const heading = interpolateVariables(
        block.content ?? brand.name,
        variables,
        true,
      );
      const plain = interpolateVariables(
        block.content ?? brand.name,
        variables,
        false,
      );
      const lightSrc = safeImageUrl(brand.logoUrl);
      const darkSrc = safeImageUrl(brand.darkLogoUrl);
      const logoMarkup = lightSrc
        ? `<img src="${lightSrc}" alt="${escapeHtml(brand.name)}" height="32" class="brand-logo-light" style="display:inline-block;max-height:32px;border:0;" />${
            darkSrc
              ? `<img src="${darkSrc}" alt="${escapeHtml(brand.name)}" height="32" class="brand-logo-dark" style="display:none;max-height:32px;border:0;" />`
              : ""
          }`
        : "";
      return {
        html: `<tr><td align="${align}" style="padding:24px 28px 12px 28px;">${logoMarkup}<h1 style="margin:${logoMarkup ? "12px" : "0"} 0 0 0;font-size:20px;line-height:28px;font-weight:600;color:${brand.accent};" class="brand-heading">${heading}</h1></td></tr>`,
        text: plain,
      };
    }
    case "text": {
      const raw = interpolateVariables(
        block.content ?? "",
        variables,
        true,
      ).replaceAll("\n", "<br />");
      const plain = interpolateVariables(block.content ?? "", variables, false);
      return {
        html: `<tr><td align="${align}" style="padding:8px 28px;font-size:15px;line-height:24px;color:#374151;" class="brand-body">${raw}</td></tr>`,
        text: plain,
      };
    }
    case "button": {
      const label = interpolateVariables(
        block.label ?? "Open",
        variables,
        true,
      );
      const plainLabel = interpolateVariables(
        block.label ?? "Open",
        variables,
        false,
      );
      const rawUrl = interpolateVariables(block.url ?? "#", variables, false);
      const href = safeHref(rawUrl);
      return {
        html: `<tr><td align="${align}" style="padding:16px 28px;"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:40px;v-text-anchor:middle;width:200px;" arcsize="15%" stroke="f" fillcolor="${brand.primary}"><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:600;">${label}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:10px 20px;border-radius:6px;background-color:${brand.primary};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:20px;">${label}</a><!--<![endif]--></td></tr>`,
        text: `${plainLabel}: ${href === "#" ? "" : rawUrl.trim()}`,
      };
    }
    case "divider":
      return {
        html: `<tr><td style="padding:12px 28px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" class="brand-divider" /></td></tr>`,
        text: "---",
      };
    case "footer": {
      const footer = interpolateVariables(block.content ?? "", variables, true);
      const plain = interpolateVariables(block.content ?? "", variables, false);
      return {
        html: `<tr><td align="${align}" style="padding:16px 28px 24px 28px;font-size:12px;line-height:18px;color:#6b7280;" class="brand-muted">${footer}</td></tr>`,
        text: plain,
      };
    }
  }
}

export function renderBrandedEmail(
  input: RenderBrandedEmailInput,
): RenderedBrandedEmail {
  const vars = input.variables ?? {};
  const primary = safeColor(input.brand.primaryColor, "#4f46e5");
  const accent = safeColor(input.brand.accentColor, "#111827");
  const subject = interpolateVariables(input.subject, vars, false)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500);

  let innerHtml = "";
  const textParts: string[] = [];

  if (input.mode === "html" && input.htmlBody) {
    const interpolated = interpolateVariables(input.htmlBody, vars, true);
    const sanitized = sanitizeEmailTemplateHtml(interpolated);
    innerHtml = `<tr><td style="padding:24px 28px;font-size:15px;line-height:24px;color:#374151;" class="brand-body">${sanitized}</td></tr>`;
    textParts.push(
      sanitized
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  } else {
    const blocks = input.blocks ?? [];
    for (const block of blocks) {
      const rendered = renderBlock(
        block,
        {
          name: input.brand.name,
          primary,
          accent,
          logoUrl: input.brand.logoUrl,
          darkLogoUrl: input.brand.darkLogoUrl,
        },
        vars,
      );
      innerHtml += rendered.html;
      if (rendered.text) textParts.push(rendered.text);
    }
  }

  const footerBits: string[] = [];
  if (input.brand.footerText) {
    footerBits.push(escapeHtml(input.brand.footerText));
    textParts.push(input.brand.footerText);
  }
  if (!input.brand.hidePoweredBy) {
    footerBits.push("Powered by Kaneo");
  }
  const footerRow = footerBits.length
    ? `<tr><td align="center" style="padding:16px 28px 24px 28px;font-size:12px;line-height:18px;color:#6b7280;" class="brand-muted">${footerBits.join(" &middot; ")}</td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(subject)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .brand-outer { background-color: #0f172a !important; }
    .brand-card { background-color: #1e293b !important; border-color: #334155 !important; }
    .brand-heading { color: #f8fafc !important; }
    .brand-body { color: #e2e8f0 !important; }
    .brand-muted { color: #94a3b8 !important; }
    .brand-divider { border-top-color: #334155 !important; }
    .brand-logo-light { display: none !important; }
    .brand-logo-dark { display: inline-block !important; }
  }
</style>
</head>
<body class="brand-outer" style="margin:0;padding:24px 12px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="brand-card" style="max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <tr><td style="height:4px;background-color:${primary};font-size:0;line-height:0;">&nbsp;</td></tr>
          ${innerHtml}
          ${footerRow}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    html,
    text: textParts.filter(Boolean).join("\n\n"),
  };
}
