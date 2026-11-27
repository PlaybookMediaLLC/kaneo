import { isOmittedDoc } from "@kaneo/branding/docs";

export const DOCS_BASE_PATH = "/docs";
export const ROOT_DOC_SLUG = "index";
export const API_REFERENCE_PATH = "/api-reference";

const DOC_ROOT_PREFIXES = [
  "/index",
  "/core",
  "/cli",
  "/quills",
  "/api-reference/",
];

export interface DocsSidebarItem {
  title: string;
  href: string;
  slug: string;
}

export interface DocsSidebarGroup {
  title: string;
  items: DocsSidebarItem[];
}

export interface DocsSidebarSection {
  id: string;
  title: string;
  icon: "book-open" | "server" | "plug" | "code";
  href: string;
  groups: DocsSidebarGroup[];
}

export function getMcpDocsHref(): string {
  return isOmittedDoc("core/integrations/mcp")
    ? `${DOCS_BASE_PATH}/core/integrations/mcp-stateless`
    : `${DOCS_BASE_PATH}/core/integrations/mcp`;
}

function cleanSlug(slug: string): string {
  return slug
    .trim()
    .replace(/^\/+/, "")
    .replace(/\.mdx?$/i, "")
    .replace(/\/+$/, "");
}

function remapOmittedSlug(slug: string): string {
  if (slug === "core/integrations/mcp" && isOmittedDoc(slug)) {
    return "core/integrations/mcp-stateless";
  }
  return slug;
}

export function getDocsUrl(slug: string): string {
  const normalized = remapOmittedSlug(cleanSlug(slug));
  if (!normalized || normalized === ROOT_DOC_SLUG) {
    return DOCS_BASE_PATH;
  }
  if (normalized.endsWith(`/${ROOT_DOC_SLUG}`)) {
    const trimmed = normalized.slice(0, -`/${ROOT_DOC_SLUG}`.length);
    return trimmed ? `${DOCS_BASE_PATH}/${trimmed}` : DOCS_BASE_PATH;
  }
  return `${DOCS_BASE_PATH}/${normalized}`;
}

export function getDocsRawUrl(slug: string): string {
  const normalized = cleanSlug(slug) || ROOT_DOC_SLUG;
  return `${DOCS_BASE_PATH}/raw/${normalized}.md`;
}

function splitHref(href: string): { path: string; suffix: string } {
  const match = href.match(/^([^?#]*)(.*)$/);
  return {
    path: match?.[1] ?? href,
    suffix: match?.[2] ?? "",
  };
}

export function normalizeDocsHref(href: string): string {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?") ||
    trimmed.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
  ) {
    return trimmed;
  }

  const { path: rawPath, suffix } = splitHref(trimmed);

  if (rawPath === "/openapi" || rawPath === "/openapi/") {
    return `${API_REFERENCE_PATH}${suffix}`;
  }

  if (
    rawPath === "/openapi.json" ||
    rawPath === API_REFERENCE_PATH ||
    rawPath === `${API_REFERENCE_PATH}/`
  ) {
    return `${rawPath.replace(/\/+$/, "")}${suffix}`;
  }

  if (rawPath === DOCS_BASE_PATH || rawPath === `${DOCS_BASE_PATH}/`) {
    return `${DOCS_BASE_PATH}${suffix}`;
  }

  if (rawPath.startsWith(`${DOCS_BASE_PATH}/`)) {
    const rest = rawPath.slice(DOCS_BASE_PATH.length + 1);
    if (
      rest.startsWith("images/") ||
      rest.startsWith("raw/") ||
      rest === "search-index.json" ||
      rest === "sitemap.xml"
    ) {
      return `${rawPath}${suffix}`;
    }
    return `${getDocsUrl(rest)}${suffix}`;
  }

  if (
    DOC_ROOT_PREFIXES.some(
      (prefix) =>
        rawPath === prefix ||
        rawPath.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    )
  ) {
    return `${getDocsUrl(rawPath)}${suffix}`;
  }

  return trimmed;
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

export function sectionContainsPath(
  section: DocsSidebarSection,
  pathname: string,
): boolean {
  const current = normalizePathname(pathname);
  if (normalizePathname(section.href) === current) {
    return true;
  }
  return section.groups.some((group) =>
    group.items.some((item) => normalizePathname(item.href) === current),
  );
}
