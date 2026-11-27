import { z } from "zod";

export const DocsContentTypeSchema = z.enum([
  "documentation",
  "self-hosting",
  "integration",
  "developer",
]);

export type DocsContentType = z.infer<typeof DocsContentTypeSchema>;

export const DocsSearchEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  section: z.string().min(1),
  group: z.string().min(1),
  type: DocsContentTypeSchema,
  keywords: z.array(z.string()),
  headings: z.array(z.string()),
  content: z.string(),
});

export type DocsSearchEntry = z.infer<typeof DocsSearchEntrySchema>;

export interface IndexedDocsSearchEntry {
  entry: DocsSearchEntry;
  titleLower: string;
  descriptionLower: string;
  sectionLower: string;
  groupLower: string;
  urlLower: string;
  keywordsLower: string[];
  headingsLower: string[];
  contentLower: string;
}

export function indexDocsSearchEntries(
  entries: DocsSearchEntry[],
): IndexedDocsSearchEntry[] {
  return entries.map((entry) => ({
    entry,
    titleLower: entry.title.toLowerCase(),
    descriptionLower: entry.description.toLowerCase(),
    sectionLower: entry.section.toLowerCase(),
    groupLower: entry.group.toLowerCase(),
    urlLower: entry.url.toLowerCase(),
    keywordsLower: entry.keywords.map((keyword) => keyword.toLowerCase()),
    headingsLower: entry.headings.map((heading) => heading.toLowerCase()),
    contentLower: entry.content.toLowerCase(),
  }));
}

function matchesAllTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((token) => haystack.includes(token));
}

function scoreEntry(
  indexed: IndexedDocsSearchEntry,
  query: string,
  tokens: string[],
): { tier: number; position: number } | null {
  // Tier 1: exact title match
  if (indexed.titleLower === query) {
    return { tier: 1, position: 0 };
  }

  // Tier 2: title prefix match
  if (indexed.titleLower.startsWith(query)) {
    return { tier: 2, position: 0 };
  }

  // Tier 3: title contains phrase or all tokens
  const titleIndex = indexed.titleLower.indexOf(query);
  if (titleIndex >= 0) {
    return { tier: 3, position: titleIndex };
  }
  if (tokens.length > 1 && matchesAllTokens(indexed.titleLower, tokens)) {
    return { tier: 3, position: indexed.titleLower.indexOf(tokens[0]) };
  }

  // Tier 4: keyword or heading match
  for (const keyword of indexed.keywordsLower) {
    const idx = keyword.indexOf(query);
    if (idx >= 0) return { tier: 4, position: idx };
  }
  for (const heading of indexed.headingsLower) {
    const idx = heading.indexOf(query);
    if (idx >= 0) return { tier: 4, position: idx };
  }
  const keywordAndHeadingCorpus = [
    ...indexed.keywordsLower,
    ...indexed.headingsLower,
  ].join(" ");
  if (
    tokens.length > 1 &&
    keywordAndHeadingCorpus.length > 0 &&
    matchesAllTokens(keywordAndHeadingCorpus, tokens)
  ) {
    return { tier: 4, position: 0 };
  }

  // Tier 5: description match
  const descIndex = indexed.descriptionLower.indexOf(query);
  if (descIndex >= 0) {
    return { tier: 5, position: descIndex };
  }
  if (tokens.length > 1 && matchesAllTokens(indexed.descriptionLower, tokens)) {
    return { tier: 5, position: indexed.descriptionLower.indexOf(tokens[0]) };
  }

  // Tier 6: URL / section / group match
  const metaCorpus = `${indexed.urlLower} ${indexed.sectionLower} ${indexed.groupLower}`;
  const metaIndex = metaCorpus.indexOf(query);
  if (metaIndex >= 0) {
    return { tier: 6, position: metaIndex };
  }
  if (tokens.length > 1 && matchesAllTokens(metaCorpus, tokens)) {
    return { tier: 6, position: metaCorpus.indexOf(tokens[0]) };
  }

  // Tier 7: full-text body content match
  const contentIndex = indexed.contentLower.indexOf(query);
  if (contentIndex >= 0) {
    return { tier: 7, position: contentIndex };
  }
  if (tokens.length > 1) {
    const fullCorpus = `${indexed.titleLower} ${indexed.descriptionLower} ${keywordAndHeadingCorpus} ${metaCorpus} ${indexed.contentLower}`;
    if (matchesAllTokens(fullCorpus, tokens)) {
      const firstPos = indexed.contentLower.indexOf(tokens[0]);
      return { tier: 7, position: firstPos >= 0 ? firstPos : 9999 };
    }
  }

  return null;
}

export function filterIndexedDocsPages(
  indexedEntries: IndexedDocsSearchEntry[],
  rawQuery: string,
): DocsSearchEntry[] {
  const query = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (!query) {
    return indexedEntries.map((item) => item.entry);
  }

  const tokens = query.split(" ").filter(Boolean);
  const scored: Array<{
    entry: DocsSearchEntry;
    tier: number;
    position: number;
  }> = [];

  for (const indexed of indexedEntries) {
    const score = scoreEntry(indexed, query, tokens);
    if (score) {
      scored.push({
        entry: indexed.entry,
        tier: score.tier,
        position: score.position,
      });
    }
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.position !== b.position) return a.position - b.position;
    if (a.entry.title.length !== b.entry.title.length) {
      return a.entry.title.length - b.entry.title.length;
    }
    const titleCmp = a.entry.title.localeCompare(b.entry.title);
    if (titleCmp !== 0) return titleCmp;
    return a.entry.url.localeCompare(b.entry.url);
  });

  return scored.map((item) => item.entry);
}

export function filterDocsPages(
  entries: DocsSearchEntry[],
  query: string,
): DocsSearchEntry[] {
  return filterIndexedDocsPages(indexDocsSearchEntries(entries), query);
}
