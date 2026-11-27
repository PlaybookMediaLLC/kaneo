import { normalizeDocsHref } from "./links";

function readAttr(attrs: string, name: string): string | undefined {
  const match = attrs.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`),
  );
  return match?.[1] ?? match?.[2];
}

function dedentBlock(value: string): string {
  const lines = value
    .replace(/^\r?\n/, "")
    .replace(/\r?\n\s*$/, "")
    .split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  const indent = Math.min(
    ...nonEmpty.map((line) => line.match(/^(\s*)/)?.[1].length ?? 0),
  );
  return lines
    .map((line) => line.slice(indent))
    .join("\n")
    .trim();
}

function formatCallout(label: string, inner: string): string {
  const body = dedentBlock(inner);
  if (!body) return "";
  const lines = body.split("\n");
  return [
    `> **${label}:** ${lines[0]}`,
    ...lines.slice(1).map((line) => (line.trim() ? `> ${line}` : ">")),
  ].join("\n");
}

function normalizeImageSrc(src: string): string {
  if (src.startsWith("/images/")) {
    return `/docs${src}`;
  }
  return src;
}

function expandFrame(attrs: string, inner: string): string {
  const caption = readAttr(attrs, "caption")?.trim();
  const images = [...inner.matchAll(/<img\b([^>]*)\/?>/gi)].map((match) => ({
    attrs: match[1] ?? "",
    src: readAttr(match[1] ?? "", "src"),
    alt: readAttr(match[1] ?? "", "alt"),
    className: readAttr(match[1] ?? "", "className") ?? "",
  }));

  const preferred =
    images.find((img) => !img.className.includes("hidden dark:block")) ??
    images[0];

  if (preferred?.src) {
    const alt = preferred.alt || caption || "";
    const src = normalizeImageSrc(preferred.src);
    return caption && caption !== alt
      ? `![${alt}](${src})\n\n*${caption}*`
      : `![${alt}](${src})`;
  }

  const body = dedentBlock(inner);
  return caption ? `${body}\n\n*${caption}*` : body;
}

function expandCard(attrs: string, inner: string): string {
  const title = readAttr(attrs, "title")?.trim() ?? "";
  const href = readAttr(attrs, "href")?.trim();
  const body = dedentBlock(inner).replace(/\s*\n\s*/g, " ");
  const normalizedHref = href ? normalizeDocsHref(href) : undefined;
  const heading = normalizedHref
    ? `[**${title}**](${normalizedHref})`
    : `**${title}**`;
  return body ? `- ${heading}: ${body}` : `- ${heading}`;
}

function expandSteps(inner: string): string {
  let index = 0;
  return inner.replace(
    /<Step\b([^>]*)>([\s\S]*?)<\/Step>/g,
    (_match, attrs: string, body: string) => {
      index += 1;
      const title = readAttr(attrs, "title")?.trim() ?? `Step ${index}`;
      const content = dedentBlock(body);
      return `\n### ${index}. ${title}\n\n${content}\n`;
    },
  );
}

/**
 * Normalize internal Markdown links outside fenced code blocks so raw markdown
 * exports and llms.txt consumers receive canonical `/docs/...` URLs.
 */
function normalizeMarkdownLinks(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part.replace(
        /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,
        (full, prefix: string, href: string, suffix: string) => {
          if (prefix.startsWith("![")) {
            return `${prefix}${normalizeImageSrc(href)}${suffix}`;
          }
          return `${prefix}${normalizeDocsHref(href)}${suffix}`;
        },
      );
    })
    .join("");
}

/**
 * Expand Mintlify JSX tags used across `apps/docs` into clean GFM Markdown
 * suitable for `/docs/raw/*.md` and `llms-full.txt`.
 */
export function expandMdxToMarkdown(body: string): string {
  let result = body;

  // Steps + Step
  result = result.replace(
    /<Steps\b[^>]*>([\s\S]*?)<\/Steps>/g,
    (_match, inner: string) => `\n${expandSteps(inner).trim()}\n`,
  );
  // Any standalone Step outside Steps
  result = result.replace(
    /<Step\b([^>]*)>([\s\S]*?)<\/Step>/g,
    (_match, attrs: string, inner: string) => {
      const title = readAttr(attrs, "title")?.trim() ?? "Step";
      return `\n### ${title}\n\n${dedentBlock(inner)}\n`;
    },
  );

  // Frame
  result = result.replace(
    /<Frame\b([^>]*)>([\s\S]*?)<\/Frame>/g,
    (_match, attrs: string, inner: string) =>
      `\n${expandFrame(attrs, inner)}\n`,
  );

  // CardGroup + Card
  result = result.replace(
    /<CardGroup\b[^>]*>([\s\S]*?)<\/CardGroup>/g,
    (_match, inner: string) => `\n${dedentBlock(inner)}\n`,
  );
  result = result.replace(
    /<Card\b([^>]*)>([\s\S]*?)<\/Card>/g,
    (_match, attrs: string, inner: string) => expandCard(attrs, inner),
  );
  result = result.replace(/<Card\b([^>]*)\/>/g, (_match, attrs: string) =>
    expandCard(attrs, ""),
  );

  // Callouts: Note, Info, Tip, Warning
  for (const tag of ["Note", "Info", "Tip", "Warning"] as const) {
    result = result.replace(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g"),
      (_match, inner: string) => `\n${formatCallout(tag, inner)}\n`,
    );
  }

  // Standalone HTML <img> tags
  result = result.replace(/<img\b([^>]*)\/?>/gi, (_match, attrs: string) => {
    const className = readAttr(attrs, "className") ?? "";
    if (className.includes("hidden dark:block")) return "";
    const src = readAttr(attrs, "src");
    if (!src) return "";
    const alt = readAttr(attrs, "alt") ?? "";
    return `![${alt}](${normalizeImageSrc(src)})`;
  });

  result = normalizeMarkdownLinks(result);

  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractMarkdownHeadings(body: string): string[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "");
  const headings: string[] = [];
  for (const match of withoutCode.matchAll(/^#{2,4}\s+(.+)$/gm)) {
    const clean = match[1]
      .replace(/\s*\{#[^}]+\}\s*$/, "")
      .replace(/[`*_~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
    if (clean) headings.push(clean);
  }
  return headings;
}

export function stripMarkdownForSearch(body: string): string {
  const expanded = expandMdxToMarkdown(body);
  return expanded
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(
      /(^|\s)[*_~]([^\s*_~][^]*?[^\s*_~]?)[*_~](?=\s|$|[.,;:!?])/g,
      "$1$2",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
