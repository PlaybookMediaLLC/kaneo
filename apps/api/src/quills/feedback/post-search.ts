import { sql, type SQL } from "drizzle-orm";
import { posts } from "../../database/quills/schema/posts";

// Post search for customers and teammates (gap G-26). The full-text match keeps its web syntax:
// "quoted phrases", -minus words and OR. A post also matches when each plain word starts a word
// in it (partial words) or is close to a word of its title (typos, pg_trgm). Minus words exclude
// in every case. shortcut: no trigram index on titles; add one if boards hold many thousands.

const WORD = /[\p{L}\p{N}]+/gu;

/** The words of a search, split into plain words and the -words to exclude, phrases included. */
export function searchTerms(search: string) {
  const plain: string[] = [];
  const minus: string[] = [];
  for (const token of search.match(/-?"[^"]*"|-?\S+/g) ?? []) {
    const words = token.match(WORD) ?? [];
    (token.startsWith("-") ? minus : plain).push(...words);
  }
  const clean = (words: string[]) =>
    [...new Set(words.map((word) => word.toLowerCase()))].slice(0, 12);
  return { plain: clean(plain), minus: clean(minus) };
}

/** The condition for posts that match a search. */
export function postSearch(search: string): SQL {
  const { plain, minus } = searchTerms(search);
  const full = sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`;
  const excluded = minus.map(
    (word) =>
      sql`not (${posts.searchVector} @@ plainto_tsquery('english', ${word}))`,
  );
  if (!plain.length) return sql.join([full, ...excluded], sql` and `);
  // Each word is a sanitized prefix term ("expor" finds "export") or, from three letters, a
  // close title word ("quartrely" finds "quarterly"). Uses `<%` without lower() so PostgreSQL
  // hits posts_title_trgm_idx (pg_trgm is case-insensitive; client.ts sets word_similarity_threshold=0.4).
  const each = plain.map((word) =>
    word.length < 3
      ? sql`${posts.searchVector} @@ to_tsquery('simple', ${`${word}:*`})`
      : sql`(${posts.searchVector} @@ to_tsquery('simple', ${`${word}:*`}) or ${word} <% ${posts.title})`,
  );
  return sql.join(
    [sql`(${full} or (${sql.join(each, sql` and `)}))`, ...excluded],
    sql` and `,
  );
}
