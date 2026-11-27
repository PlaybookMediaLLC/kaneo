import { brandResources } from "@kaneo/branding";
import {
  brandDocsConfig,
  brandMarkdown,
  isOmittedDoc,
} from "@kaneo/branding/docs";
import { frontmatter as parseFrontmatter } from "fumadocs-core/content/md/frontmatter";
import type * as PageTree from "fumadocs-core/page-tree";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  API_REFERENCE_PATH,
  DOCS_BASE_PATH,
  type DocsSidebarGroup,
  type DocsSidebarItem,
  type DocsSidebarSection,
  getDocsRawUrl,
  getDocsUrl,
  normalizeDocsHref,
  ROOT_DOC_SLUG,
} from "./links";
import {
  expandMdxToMarkdown,
  extractMarkdownHeadings,
  stripMarkdownForSearch,
} from "./markdown-transform";
import {
  type DocsContentType,
  type DocsSearchEntry,
  DocsSearchEntrySchema,
} from "./search-filter";

const DocsFrontmatterSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sidebarTitle: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

interface DocsJsonGroup {
  group: string;
  pages?: string[];
  openapi?: string;
}

interface DocsJsonTab {
  tab: string;
  groups: DocsJsonGroup[];
}

interface DocsJsonRedirect {
  source: string;
  destination: string;
}

interface BrandedDocsConfig {
  name: string;
  redirects?: DocsJsonRedirect[];
  navigation: {
    tabs: DocsJsonTab[];
  };
}

export interface DocsPageRecord {
  /** Normalized file-relative slug without `.mdx`, e.g. `index`, `core/index`, `core/installation/docker-compose`. */
  slug: string;
  /** Route segments under `/docs/[[...slug]]`; empty array for root `/docs`. */
  slugs: string[];
  /** Canonical public URL path, e.g. `/docs`, `/docs/core`, `/docs/core/installation/docker-compose`. */
  url: string;
  /** Static raw markdown export URL, e.g. `/docs/raw/index.md`. */
  rawUrl: string;
  title: string;
  sidebarTitle: string;
  description: string;
  keywords: string[];
  headings: string[];
  section: string;
  group: string;
  type: DocsContentType;
  /** Branded MDX content without frontmatter. */
  body: string;
  /** Absolute source path on disk (for debugging/tests). */
  sourcePath: string;
}

export interface DocsRedirectRecord {
  /** Segments under `/docs/[[...slug]]` for the legacy source path. */
  slugs: string[];
  sourceUrl: string;
  destinationUrl: string;
}

const SECTION_META: Array<{
  id: string;
  icon: DocsSidebarSection["icon"];
  type: DocsContentType;
}> = [
  { id: "using", icon: "book-open", type: "documentation" },
  { id: "self-hosting", icon: "server", type: "self-hosting" },
  { id: "integrations", icon: "plug", type: "integration" },
  { id: "developers", icon: "code", type: "developer" },
];

export function resolveDocsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "apps/docs"),
    path.resolve(process.cwd(), "../docs"),
    path.resolve(process.cwd(), "../../apps/docs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "docs.json"))) {
      return candidate;
    }
  }
  throw new Error(
    `Unable to locate apps/docs directory from cwd=${process.cwd()}`,
  );
}

function collectMdxFiles(dir: string, relativePrefix = ""): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (rel === "api-reference/endpoints") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdxFiles(full, rel));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      results.push(rel);
    }
  }
  return results.sort();
}

function slugToRouteSegments(slug: string): string[] {
  if (slug === ROOT_DOC_SLUG) return [];
  if (slug.endsWith(`/${ROOT_DOC_SLUG}`)) {
    return slug.slice(0, -`/${ROOT_DOC_SLUG}`.length).split("/");
  }
  return slug.split("/");
}

function deriveFallbackDescription(body: string): string {
  const plain = stripMarkdownForSearch(body);
  if (plain.length <= 160) return plain;
  const trimmed = plain.slice(0, 157);
  const lastSpace = trimmed.lastIndexOf(" ");
  return `${(lastSpace > 80 ? trimmed.slice(0, lastSpace) : trimmed).trim()}...`;
}

interface LoadedDocsStore {
  docsDir: string;
  config: BrandedDocsConfig;
  pages: DocsPageRecord[];
  byUrl: Map<string, DocsPageRecord>;
  bySlug: Map<string, DocsPageRecord>;
  sections: DocsSidebarSection[];
  pageTree: PageTree.Root;
  redirects: DocsRedirectRecord[];
}

let cachedStore: LoadedDocsStore | null = null;

function loadDocsStore(): LoadedDocsStore {
  if (cachedStore) return cachedStore;

  const docsDir = resolveDocsDir();
  const rawConfig = JSON.parse(
    readFileSync(path.join(docsDir, "docs.json"), "utf8"),
  ) as BrandedDocsConfig;
  const config = brandDocsConfig(rawConfig);

  // Build lookup from slug -> { section, group, type } using docs.json order
  const taxonomyBySlug = new Map<
    string,
    { section: string; group: string; type: DocsContentType }
  >();
  for (const [tabIndex, tab] of config.navigation.tabs.entries()) {
    const meta = SECTION_META[tabIndex] ?? {
      id: `section-${tabIndex}`,
      icon: "book-open" as const,
      type: "documentation" as const,
    };
    for (const group of tab.groups) {
      for (const pageSlug of group.pages ?? []) {
        if (!isOmittedDoc(pageSlug) && !taxonomyBySlug.has(pageSlug)) {
          taxonomyBySlug.set(pageSlug, {
            section: tab.tab,
            group: group.group,
            type: meta.type,
          });
        }
      }
    }
  }

  const mdxFiles = collectMdxFiles(docsDir);
  const pages: DocsPageRecord[] = [];
  const byUrl = new Map<string, DocsPageRecord>();
  const bySlug = new Map<string, DocsPageRecord>();

  for (const relFile of mdxFiles) {
    const slug = relFile.replace(/\.mdx$/, "");
    if (isOmittedDoc(slug)) continue;

    const sourcePath = path.join(docsDir, relFile);
    const rawSource = readFileSync(sourcePath, "utf8");
    const branded = brandMarkdown(rawSource);
    const parsed = parseFrontmatter(branded);
    const fm = DocsFrontmatterSchema.parse(parsed.data);

    const url = getDocsUrl(slug);
    const slugs = slugToRouteSegments(slug);
    const body = parsed.content.trim();
    const taxonomy = taxonomyBySlug.get(slug) ?? {
      section: config.navigation.tabs[1]?.tab ?? "Self-hosting",
      group: "Reference",
      type: "self-hosting" as const,
    };

    const record: DocsPageRecord = {
      slug,
      slugs,
      url,
      rawUrl: getDocsRawUrl(slug),
      title: fm.title.trim(),
      sidebarTitle: (fm.sidebarTitle ?? fm.title).trim(),
      description: fm.description?.trim() || deriveFallbackDescription(body),
      keywords: fm.keywords ?? [],
      headings: extractMarkdownHeadings(body),
      section: taxonomy.section,
      group: taxonomy.group,
      type: taxonomy.type,
      body,
      sourcePath,
    };

    pages.push(record);
    bySlug.set(slug, record);
    byUrl.set(url, record);
  }

  // Build sidebar sections & Fumadocs PageTree in exact docs.json reading order
  const sections: DocsSidebarSection[] = [];
  const treeChildren: PageTree.Node[] = [];

  for (const [tabIndex, tab] of config.navigation.tabs.entries()) {
    const meta = SECTION_META[tabIndex] ?? {
      id: `section-${tabIndex}`,
      icon: "book-open" as const,
      type: "documentation" as const,
    };
    const groups: DocsSidebarGroup[] = [];
    const tabTreeChildren: PageTree.Node[] = [];

    for (const group of tab.groups) {
      const items: DocsSidebarItem[] = [];
      const groupTreeChildren: PageTree.Node[] = [];

      for (const pageSlug of group.pages ?? []) {
        if (isOmittedDoc(pageSlug)) continue;
        const page = bySlug.get(pageSlug);
        if (!page) continue;
        items.push({
          title: page.sidebarTitle,
          href: page.url,
          slug: page.slug,
        });
        groupTreeChildren.push({
          type: "page",
          name: page.sidebarTitle,
          url: page.url,
          description: page.description,
        });
      }

      if (group.openapi) {
        items.push({
          title: "Interactive API Reference",
          href: API_REFERENCE_PATH,
          slug: "api-reference",
        });
        groupTreeChildren.push({
          type: "page",
          name: "Interactive API Reference",
          url: API_REFERENCE_PATH,
        });
      }

      if (items.length > 0) {
        groups.push({ title: group.group, items });
        tabTreeChildren.push({
          type: "folder",
          name: group.group,
          defaultOpen: true,
          children: groupTreeChildren,
        });
      }
    }

    const firstHref = groups[0]?.items[0]?.href ?? DOCS_BASE_PATH;
    sections.push({
      id: meta.id,
      title: tab.tab,
      icon: meta.icon,
      href: firstHref,
      groups,
    });

    treeChildren.push({
      type: "folder",
      name: tab.tab,
      defaultOpen: true,
      children: tabTreeChildren,
    });
  }

  const pageTree: PageTree.Root = {
    name: config.name,
    children: treeChildren,
  };

  // Build static redirects from docs.json
  const redirects: DocsRedirectRecord[] = [];
  for (const redirect of config.redirects ?? []) {
    const sourceUrl = normalizeDocsHref(redirect.source);
    const destinationUrl = normalizeDocsHref(redirect.destination);
    if (!sourceUrl.startsWith(`${DOCS_BASE_PATH}/`)) continue;
    if (byUrl.has(sourceUrl)) continue;
    const slugs = sourceUrl.slice(`${DOCS_BASE_PATH}/`.length).split("/");
    redirects.push({
      slugs,
      sourceUrl,
      destinationUrl,
    });
  }

  cachedStore = {
    docsDir,
    config,
    pages,
    byUrl,
    bySlug,
    sections,
    pageTree,
    redirects,
  };

  return cachedStore;
}

export const docsSource = {
  get pageTree(): PageTree.Root {
    return loadDocsStore().pageTree;
  },

  getPages(): DocsPageRecord[] {
    return loadDocsStore().pages;
  },

  getPage(slugs?: string[]): DocsPageRecord | undefined {
    const store = loadDocsStore();
    if (!slugs || slugs.length === 0) {
      return store.bySlug.get(ROOT_DOC_SLUG);
    }
    // Reject explicit `/index` segments so canonical URLs stay deduplicated
    if (slugs[slugs.length - 1] === ROOT_DOC_SLUG) {
      return undefined;
    }
    const joined = slugs.join("/");
    return (
      store.bySlug.get(joined) ?? store.bySlug.get(`${joined}/${ROOT_DOC_SLUG}`)
    );
  },

  getPageByUrl(url: string): DocsPageRecord | undefined {
    const store = loadDocsStore();
    const cleaned = url.replace(/\/+$/, "") || "/";
    if (cleaned === `${DOCS_BASE_PATH}/${ROOT_DOC_SLUG}`) {
      return undefined;
    }
    return store.byUrl.get(cleaned);
  },

  generateParams(): Array<{ slug?: string[] }> {
    const store = loadDocsStore();
    return store.pages.map((page) => ({
      slug: page.slugs,
    }));
  },
};

export function getDocsConfig(): BrandedDocsConfig {
  return loadDocsStore().config;
}

export function getDocsSidebarSections(): DocsSidebarSection[] {
  return loadDocsStore().sections;
}

export function getDocsRedirects(): DocsRedirectRecord[] {
  return loadDocsStore().redirects;
}

export function getDocsRedirect(
  slugs?: string[],
): DocsRedirectRecord | undefined {
  if (!slugs || slugs.length === 0) return undefined;
  const target = `${DOCS_BASE_PATH}/${slugs.join("/")}`;
  return loadDocsStore().redirects.find((item) => item.sourceUrl === target);
}

export function getDocsSearchEntries(): DocsSearchEntry[] {
  const store = loadDocsStore();
  const entries: DocsSearchEntry[] = store.pages.map((page) => ({
    id: page.slug,
    url: page.url,
    title: page.title,
    description: page.description,
    section: page.section,
    group: page.group,
    type: page.type,
    keywords: page.keywords,
    headings: page.headings,
    content: stripMarkdownForSearch(page.body),
  }));

  entries.push({
    id: "api-reference",
    url: API_REFERENCE_PATH,
    title: "Interactive API Reference",
    description:
      "Explore every REST API endpoint, request schema, and response payload interactively from the OpenAPI specification.",
    section: store.config.navigation.tabs[3]?.tab ?? "Developers",
    group: "Endpoint reference",
    type: "developer",
    keywords: ["openapi", "rest", "api", "endpoints", "swagger", "scalar"],
    headings: ["OpenAPI", "Endpoints", "Authentication"],
    content:
      "Interactive OpenAPI REST API explorer for workspaces, projects, tasks, comments, labels, webhooks, imports, and portal endpoints.",
  });

  return DocsSearchEntrySchema.array().parse(entries);
}

export function getDocsMarkdown(pathnameOrSlug: string): string | undefined {
  const store = loadDocsStore();
  const cleaned = pathnameOrSlug.trim().replace(/\/+$/, "");

  // Reject explicit `/docs/index` so only canonical paths resolve
  if (
    cleaned === `${DOCS_BASE_PATH}/${ROOT_DOC_SLUG}` ||
    cleaned.endsWith(`/${ROOT_DOC_SLUG}`)
  ) {
    // Allow direct slug lookup via raw slug (without leading slash)
    if (cleaned.startsWith("/")) {
      return undefined;
    }
  }

  let page: DocsPageRecord | undefined;
  if (cleaned === DOCS_BASE_PATH) {
    page = store.bySlug.get(ROOT_DOC_SLUG);
  } else if (cleaned.startsWith(`${DOCS_BASE_PATH}/`)) {
    page = store.byUrl.get(cleaned);
  } else {
    const normalizedSlug = cleaned.replace(/^\/+/, "").replace(/\.mdx?$/i, "");
    if (isOmittedDoc(normalizedSlug)) return undefined;
    page = store.bySlug.get(normalizedSlug);
  }

  if (!page) return undefined;

  const expanded = expandMdxToMarkdown(page.body);
  const header = page.description
    ? `# ${page.title}\n\n> ${page.description}`
    : `# ${page.title}`;
  return `${header}\n\n${expanded}\n`;
}

export function getDocsRawParams(): Array<{ slug: string[] }> {
  return loadDocsStore().pages.map((page) => {
    const segments = page.slug.split("/");
    const last = segments[segments.length - 1];
    return {
      slug: [...segments.slice(0, -1), `${last}.md`],
    };
  });
}

export function getDocsPageByRawSlug(
  rawSegments: string[],
): DocsPageRecord | undefined {
  if (!rawSegments.length) return undefined;
  const last = rawSegments[rawSegments.length - 1];
  if (!last.endsWith(".md")) return undefined;
  const slug = [...rawSegments.slice(0, -1), last.slice(0, -".md".length)].join(
    "/",
  );
  if (isOmittedDoc(slug)) return undefined;
  return loadDocsStore().bySlug.get(slug);
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

export function getDocsImagePaths(): string[][] {
  const imagesDir = path.join(resolveDocsDir(), "images");
  if (!existsSync(imagesDir)) return [];

  const results: string[][] = [];
  function walk(dir: string, prefix: string[]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = [...prefix, entry.name];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, next);
      } else if (
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        results.push(next);
      }
    }
  }
  walk(imagesDir, []);
  return results.sort((a, b) => a.join("/").localeCompare(b.join("/")));
}

export function readDocsImage(
  segments: string[],
): { bytes: Buffer; contentType: string } | undefined {
  if (
    !segments.length ||
    segments.some(
      (seg) =>
        !seg ||
        seg === "." ||
        seg === ".." ||
        seg.includes("/") ||
        seg.includes("\\"),
    )
  ) {
    return undefined;
  }
  const imagesDir = path.join(resolveDocsDir(), "images");
  const fullPath = path.resolve(imagesDir, ...segments);
  if (!fullPath.startsWith(`${imagesDir}${path.sep}`)) {
    return undefined;
  }
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    return undefined;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  const contentType = contentTypes[ext];
  if (!contentType) return undefined;
  return {
    bytes: readFileSync(fullPath),
    contentType,
  };
}

export function getBrandedOpenApiSpec(): Record<string, unknown> {
  const specPath = path.join(resolveDocsDir(), "openapi.json");
  const parsed = JSON.parse(readFileSync(specPath, "utf8")) as Record<
    string,
    unknown
  >;
  return brandResources(parsed);
}
