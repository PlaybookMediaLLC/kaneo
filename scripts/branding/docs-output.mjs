import { existsSync } from "node:fs";
import path from "node:path";

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_match, entity) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number(entity.slice(1)));
      }
      return named[entity.toLowerCase()] ?? _match;
    },
  );
}

function normalizeDocLinks(text) {
  return text.replace(
    /(\]\()(\/(?:core|cli|quills|api-reference)\/[^)]*)/g,
    "$1/docs$2",
  );
}

function stripMarkdownSyntax(text) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[>\-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "td",
  "th",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "br",
]);

function flattenFlightText(line) {
  // React Flight / RSC payloads serialize JSX trees as JSON arrays/objects like:
  // `["$","span",null,{"style":{...},"children":"mkdir"}],["$","span",null,{"children":" kaneo"}]`
  // Reconstruct the contiguous rendered text so reviewed multi-token lines match verbatim,
  // while collecting href/id attributes separately so links and anchors are still verified.
  const colonIdx = line.indexOf(":");
  if (
    colonIdx > 0 &&
    colonIdx <= 8 &&
    /^[0-9a-f]+$/i.test(line.slice(0, colonIdx))
  ) {
    const payload = line.slice(colonIdx + 1);
    try {
      const parsed = JSON.parse(payload);
      const chunks = [];
      const attrs = [];
      const walk = (node) => {
        if (typeof node === "string") {
          chunks.push(node);
          return;
        }
        if (Array.isArray(node)) {
          // React element tuple: ["$", tag, key, props]
          if (
            node[0] === "$" &&
            node.length >= 4 &&
            node[3] &&
            typeof node[3] === "object"
          ) {
            const tag = typeof node[1] === "string" ? node[1] : "";
            const props = node[3];
            if (typeof props.href === "string") attrs.push(props.href);
            if (typeof props.id === "string") attrs.push(props.id);
            if (BLOCK_TAGS.has(tag)) chunks.push(" ");
            if (props.children !== undefined) walk(props.children);
            if (BLOCK_TAGS.has(tag)) chunks.push(" ");
            return;
          }
          for (const item of node) walk(item);
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, val] of Object.entries(node)) {
            if (key === "style" || key === "className") continue;
            if (
              (key === "href" || key === "url" || key === "id") &&
              typeof val === "string"
            ) {
              attrs.push(val);
              continue;
            }
            walk(val);
          }
        }
      };
      walk(parsed);
      return attrs.length > 0
        ? `${chunks.join("")}\n${attrs.join("\n")}`
        : chunks.join("");
    } catch {
      // Fall through to raw string inspection if not a JSON Flight line.
    }
  }
  return null;
}

function flattenHtmlText(line) {
  // Next.js static HTML lines can contain both rendered HTML markup (with Shiki <span> tokens)
  // and inline `<script>self.__next_f.push([1,"..."])</script>` Flight payloads.
  const parts = [];
  const attrs = [];
  const withoutScripts = line.replace(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    (_match, scriptBody) => {
      for (const pushMatch of scriptBody.matchAll(
        /self\.__next_f\.push\(\[\d+,"((?:\\.|[^"\\])*)"\]\)/g,
      )) {
        try {
          const decoded = JSON.parse(`"${pushMatch[1]}"`);
          for (const subline of decoded.split("\n")) {
            const flattened = flattenFlightText(subline);
            parts.push(flattened ?? subline);
          }
        } catch {
          parts.push(pushMatch[1]);
        }
      }
      // Keep non-Flight inline scripts (like the theme initializer) intact so they are still checked.
      if (!scriptBody.includes("self.__next_f.push")) {
        parts.push(scriptBody);
      }
      return " ";
    },
  );
  // Extract href/id attributes separately so prose stays contiguous while links/anchors are still checked.
  const stripped = withoutScripts
    .replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (_match, tag, rawAttrs) => {
      for (const attr of rawAttrs.matchAll(/\b(?:href|id)="([^"]*)"/gi)) {
        attrs.push(decodeHtmlEntities(attr[1]));
      }
      return BLOCK_TAGS.has(tag.toLowerCase()) ? " " : "";
    })
    .replace(/<\/([a-z][a-z0-9-]*)>/gi, (_match, tag) =>
      BLOCK_TAGS.has(tag.toLowerCase()) ? " " : "",
    );
  const plain = decodeHtmlEntities(stripped);
  parts.unshift(plain);
  if (attrs.length > 0) {
    parts.push(attrs.join("\n"));
  }
  return parts.join("\n");
}

function collectFragmentsForException(
  item,
  exceptionValue,
  brandText,
  matches,
) {
  const candidates = new Set();
  const add = (value, allowShort = false) => {
    const normalized = exceptionValue(value).trim();
    if (!normalized) return;
    if (allowShort || normalized.length >= 6) {
      candidates.add(normalized);
    }
    const collapsed = normalized.replace(/\s+/g, " ");
    if (collapsed && (allowShort || collapsed.length >= 6)) {
      candidates.add(collapsed);
    }
  };

  for (const raw of [item.value, brandText(item.value)]) {
    const trimmed = raw.trim();
    const isExactShortLine = trimmed.length > 0 && trimmed.length < 15;
    add(trimmed, isExactShortLine);
    add(normalizeDocLinks(trimmed), isExactShortLine);

    // Strip JSON `key.path: "value"` wrapper for docs.json reviewed entries
    const jsonValMatch = trimmed.match(/^[^:]+:\s*"([^"]+)"$/);
    if (jsonValMatch) {
      const inner = jsonValMatch[1];
      add(inner);
      add(`/docs/${inner.replace(/^\/+/, "")}`);
      add(`/docs/raw/${inner.replace(/^\/+/, "")}.md`);
      const lastSeg = inner.split("/").pop();
      if (lastSeg && matches(lastSeg).length > 0) {
        add(lastSeg, true);
      }
    }

    // Strip YAML frontmatter key prefix (`description: ...`)
    const fmMatch = trimmed.match(
      /^(?:title|description|sidebarTitle):\s*(.+)$/,
    );
    if (fmMatch) {
      add(fmMatch[1].replace(/^["']|["']$/g, ""));
    }

    // Add markdown-stripped form for HTML/search-index comparisons
    const stripped = stripMarkdownSyntax(trimmed);
    add(stripped, isExactShortLine);

    // Add individual backtick code spans that contain the prohibited term
    for (const codeSpan of trimmed.matchAll(/`([^`]+)`/g)) {
      if (matches(codeSpan[1]).length > 0) {
        add(codeSpan[1], true);
      }
    }

    // Add individual reviewed technical tokens containing the prohibited term,
    // scoped strictly to this single MDX file (handles React Flight deduplicated spans).
    for (const token of stripped.split(/[\s"'()[\]{},;=]+/)) {
      if (token && matches(token).length > 0) {
        add(token, true);
      }
    }

    // Add markdown link hrefs that contain the prohibited term (plus /docs-prefixed variant)
    for (const linkMatch of trimmed.matchAll(/\]\(([^)]+)\)/g)) {
      if (matches(linkMatch[1]).length > 0) {
        add(linkMatch[1]);
        if (
          linkMatch[1].startsWith("/") &&
          !linkMatch[1].startsWith("/docs/")
        ) {
          add(`/docs${linkMatch[1]}`);
        }
      }
    }

    // Add heading anchor slug for reviewed `### \`kaneo ...\`` headings
    const headingMatch = trimmed.match(/^#{2,6}\s+`?([^`]+)`?$/);
    if (headingMatch && matches(headingMatch[1]).length > 0) {
      const slug = headingMatch[1]
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      if (slug) add(slug, true);
    }
  }

  return [...candidates].map((fragment) => ({
    fragment,
    term: item.term ?? "",
  }));
}

export function resolveExportedDocsTarget(relative, rootDir) {
  if (relative === "apps/site/out/openapi.json") {
    return { kind: "openapi", sourceFile: "apps/docs/openapi.json" };
  }
  if (relative === "apps/site/out/docs/sitemap.xml") {
    return { kind: "docs-file", sourceFile: "apps/docs/docs.json" };
  }
  if (relative === "apps/site/out/docs/search-index.json") {
    return { kind: "search-index" };
  }
  if (
    relative === "apps/site/out/llms.txt" ||
    relative === "apps/site/out/llms-full.txt"
  ) {
    return { kind: "all-docs" };
  }
  if (
    relative.startsWith("apps/site/out/docs/raw/") &&
    relative.endsWith(".md")
  ) {
    const slug = relative.slice(
      "apps/site/out/docs/raw/".length,
      -".md".length,
    );
    return { kind: "docs-file", sourceFile: `apps/docs/${slug}.mdx` };
  }
  if (
    relative === "apps/site/out/docs.html" ||
    relative === "apps/site/out/docs.txt" ||
    /^apps\/site\/out\/docs\/__next[^/]*\.txt$/.test(relative)
  ) {
    return { kind: "docs-file", sourceFile: "apps/docs/index.mdx" };
  }
  if (relative.startsWith("apps/site/out/docs/")) {
    const rest = relative.slice("apps/site/out/docs/".length);
    let route = null;
    if (rest.endsWith(".html")) {
      route = rest.slice(0, -".html".length);
    } else if (rest.endsWith(".txt")) {
      const dir = path.posix.dirname(rest);
      const base = path.posix.basename(rest);
      route = base.startsWith("__next")
        ? dir === "."
          ? ""
          : dir
        : rest.slice(0, -".txt".length);
    }
    if (route !== null) {
      if (!route) {
        return { kind: "docs-file", sourceFile: "apps/docs/index.mdx" };
      }
      const directMdx = `apps/docs/${route}.mdx`;
      if (existsSync(path.join(rootDir, directMdx))) {
        return { kind: "docs-file", sourceFile: directMdx };
      }
      const indexMdx = `apps/docs/${route}/index.mdx`;
      if (existsSync(path.join(rootDir, indexMdx))) {
        return { kind: "docs-file", sourceFile: indexMdx };
      }
      return { kind: "docs-file", sourceFile: "apps/docs/docs.json" };
    }
  }
  return null;
}

export function createExportedDocsMatcher({
  exceptions,
  reviewedCode,
  exceptionValue,
  brandText,
  matches,
}) {
  const byFile = new Map();
  const globalFragments = [];
  const allDocsFragments = [];

  for (const item of exceptions) {
    if (!item.file.startsWith("apps/docs/")) continue;
    const fragments = collectFragmentsForException(
      item,
      exceptionValue,
      brandText,
      matches,
    );
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(...fragments);
    allDocsFragments.push(...fragments);
    if (item.file === "apps/docs/docs.json") {
      globalFragments.push(...fragments);
    }
  }

  for (const entry of reviewedCode) {
    const [fragment, term] = entry.split("\0");
    if (fragment.length >= 8) {
      globalFragments.push({ fragment, term });
    }
  }

  const dedupeAndSort = (list) => {
    const seen = new Set();
    const unique = [];
    for (const item of list) {
      const key = `${item.fragment}\0${item.term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique.sort((a, b) => b.fragment.length - a.fragment.length);
  };

  const sortedGlobal = dedupeAndSort(globalFragments);
  const sortedAll = dedupeAndSort([...allDocsFragments, ...globalFragments]);
  const sortedByFileCache = new Map();

  const fragmentsForFile = (sourceFile) => {
    if (!sortedByFileCache.has(sourceFile)) {
      sortedByFileCache.set(
        sourceFile,
        dedupeAndSort([...(byFile.get(sourceFile) ?? []), ...sortedGlobal]),
      );
    }
    return sortedByFileCache.get(sourceFile);
  };

  const coveredResultCache = new Map();

  const isCoveredByFragments = (rawText, term, fragments, scopeKey) => {
    const cacheKey = `${scopeKey}\0${term}\0${rawText}`;
    if (coveredResultCache.has(cacheKey)) {
      return coveredResultCache.get(cacheKey);
    }
    let uncovered = exceptionValue(rawText);
    for (const { fragment, term: expectedTerm } of fragments) {
      if (expectedTerm && expectedTerm !== term) continue;
      if (!uncovered.includes(fragment)) continue;
      uncovered = uncovered.split(fragment).join(" ".repeat(fragment.length));
    }
    if (!matches(uncovered).some((match) => match.term === term)) {
      coveredResultCache.set(cacheKey, true);
      return true;
    }
    // Also check collapsed-whitespace view for multiline wrapped HTML/markdown text
    let collapsed = exceptionValue(rawText).replace(/\s+/g, " ");
    for (const { fragment, term: expectedTerm } of fragments) {
      if (expectedTerm && expectedTerm !== term) continue;
      if (!collapsed.includes(fragment)) continue;
      collapsed = collapsed.split(fragment).join(" ".repeat(fragment.length));
    }
    const result = !matches(collapsed).some((match) => match.term === term);
    coveredResultCache.set(cacheKey, result);
    return result;
  };

  const findingCache = new Map();

  return function isExportedDocsFindingCovered(finding, target, parsedJson) {
    if (!target || target.kind === "openapi") return false;

    const lineKey = `${finding.file}\0${finding.line}\0${finding.term}\0${
      target.kind === "search-index" ? finding.value.slice(0, 32) : ""
    }`;
    if (findingCache.has(lineKey)) {
      return findingCache.get(lineKey);
    }

    let fragments;
    let scopeKey;
    if (target.kind === "all-docs") {
      fragments = sortedAll;
      scopeKey = "all-docs";
    } else if (target.kind === "search-index") {
      const idxMatch = finding.value.match(/^(\d+)\./);
      const entry =
        idxMatch && Array.isArray(parsedJson)
          ? parsedJson[Number(idxMatch[1])]
          : null;
      const sourceFile =
        entry && typeof entry.id === "string"
          ? `apps/docs/${entry.id}.mdx`
          : "apps/docs/docs.json";
      fragments = fragmentsForFile(sourceFile);
      scopeKey = sourceFile;
      const colonIdx = finding.value.indexOf(": ");
      const rawValueText =
        colonIdx >= 0 ? finding.value.slice(colonIdx + 2) : finding.value;
      let valueText = rawValueText;
      try {
        const parsed = JSON.parse(rawValueText);
        if (typeof parsed === "string") valueText = parsed;
      } catch {
        // Keep rawValueText if not a JSON string literal.
      }
      const ok = isCoveredByFragments(
        valueText,
        finding.term,
        fragments,
        scopeKey,
      );
      findingCache.set(lineKey, ok);
      return ok;
    } else {
      fragments = fragmentsForFile(target.sourceFile);
      scopeKey = target.sourceFile;
    }

    let ok = isCoveredByFragments(
      finding.value,
      finding.term,
      fragments,
      scopeKey,
    );
    if (!ok && finding.file.endsWith(".html")) {
      const flattened = flattenHtmlText(finding.value);
      ok = isCoveredByFragments(flattened, finding.term, fragments, scopeKey);
    } else if (!ok && finding.file.endsWith(".txt")) {
      const flattened = flattenFlightText(finding.value);
      if (flattened !== null) {
        ok = isCoveredByFragments(flattened, finding.term, fragments, scopeKey);
      }
    }

    findingCache.set(lineKey, ok);
    return ok;
  };
}
