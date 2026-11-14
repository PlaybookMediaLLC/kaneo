// Words that say little about what a request is for.
const filler = new Set([
  "add",
  "and",
  "are",
  "can",
  "for",
  "from",
  "have",
  "into",
  "like",
  "please",
  "should",
  "that",
  "the",
  "this",
  "with",
  "would",
  "you",
  "your",
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !filler.has(word));

/**
 * True when a post title has at least two thirds of the words that the viewer typed.
 * A word matches the start of a title word, or the reverse, so "export" matches "exports".
 */
// ponytail: plain word overlap; use the server's search rank when the similar-posts API returns one.
export function isStrongMatch(typed: string, title: string) {
  const wanted = words(typed);
  const found = words(title);
  const matched = wanted.filter((word) =>
    found.some((other) => other.startsWith(word) || word.startsWith(other)),
  );
  return wanted.length > 0 && matched.length * 3 >= wanted.length * 2;
}
