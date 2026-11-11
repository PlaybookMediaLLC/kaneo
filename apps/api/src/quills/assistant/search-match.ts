// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

// The ranking rule of workspace search (the source's search-match.ts and shared/ask-search.ts):
// score = titleTier + textScore. titleTier is 3 when the title is the query, 2 when it starts with
// it, 1 when it contains it (case ignored). textScore is ts_rank normalised under 1, so a title
// match always outranks a body-only match.

/** A "contains" match needs this many characters; a shorter query uses full text only. */
export const MIN_CONTAINS_LENGTH = 3;

/** `like` pattern text with its wildcards taken literally. */
export const likeText = (text: string) =>
  text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The best title tier over the columns: 3 equal, 2 starts with, 1 contains, else 0. */
export function titleTier(text: string, ...columns: SQL[]): SQL<number> {
  const lower = text.toLowerCase();
  const tiers = columns.map(
    (column) => sql`(case when lower(${column}) = ${lower} then 3
      when lower(${column}) like ${`${likeText(lower)}%`} then 2
      when lower(${column}) like ${`%${likeText(lower)}%`} then 1 else 0 end)`,
  );
  return sql<number>`greatest(${sql.join(tiers, sql`, `)}, 0)`;
}

/** The column contains the query, case ignored. Null below MIN_CONTAINS_LENGTH. */
export const titleContains = (text: string, column: SQL | AnyColumn) =>
  text.length < MIN_CONTAINS_LENGTH
    ? null
    : sql`${column} ilike ${`%${likeText(text)}%`}`;

/** A candidate: the text matches the query, or the title contains it. */
export function textOrTitle(text: string, tsq: SQL, vector: SQL, title: SQL) {
  const fts = sql`${vector} @@ ${tsq}`;
  const contains = titleContains(text, title);
  return {
    where: contains ? sql`(${fts} or ${contains})` : fts,
    textScore: sql<number>`ts_rank(${vector}, ${tsq}, 32)`,
  };
}

/** Best score first, then the newest update (none last), then the ID. */
export const bestFirst = (
  score: SQL,
  updatedAt: SQL | AnyColumn,
  id: SQL | AnyColumn,
) => [sql`${score} desc`, sql`${updatedAt} desc nulls last`, sql`${id}`];

const EXCERPT_CHARS = 200;

/**
 * Plain text around the first query word found, so a result shows why it matched. Strips tags and
 * Markdown marks, folds whitespace, and adds an ellipsis where the passage was cut.
 */
export function searchExcerpt(content: string, query: string): string {
  const text = content
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const lower = text.toLowerCase();
  const at = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, 10)
    .map((word) => lower.indexOf(word))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined || at < EXCERPT_CHARS / 2)
    return `${text.slice(0, EXCERPT_CHARS).trim()}…`;
  const space = text.lastIndexOf(" ", at - 40);
  const start = space < 0 ? 0 : space + 1;
  const end = Math.min(text.length, start + EXCERPT_CHARS);
  return `…${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
