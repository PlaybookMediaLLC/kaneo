// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// The voting-bias keys of a board's settings JSON (RFC 0003, D6). Pure: no database access.

export const VOTE_DISPLAYS = ["count", "hidden"] as const;
export const DEFAULT_SORTS = ["votes", "newest", "random"] as const;

export type BoardVoting = {
  voteDisplay: (typeof VOTE_DISPLAYS)[number];
  /** Null: the board names no default, so the caller's own default applies. */
  defaultSort: (typeof DEFAULT_SORTS)[number] | null;
};

const pick = <T extends string>(values: readonly T[], value: unknown) =>
  values.includes(value as T) ? (value as T) : null;

/** The stored keys. A missing or unknown value reads as the default. */
export function votingOf(settings: unknown): BoardVoting {
  const stored =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  return {
    voteDisplay: pick(VOTE_DISPLAYS, stored.voteDisplay) ?? "count",
    defaultSort: pick(DEFAULT_SORTS, stored.defaultSort),
  };
}
