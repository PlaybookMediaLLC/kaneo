/** The comments to show: live ones, and deleted ones that still head a visible reply. */
export function visibleComments<
  T extends { id: string; parentId: string | null; deleted: boolean },
>(comments: T[]): T[] {
  const replies = new Map<string, T[]>();
  for (const comment of comments)
    if (comment.parentId)
      replies.set(comment.parentId, [
        ...(replies.get(comment.parentId) ?? []),
        comment,
      ]);
  const shown = new Map<string, boolean>();
  const shows = (comment: T): boolean => {
    const known = shown.get(comment.id);
    if (known !== undefined) return known;
    shown.set(comment.id, false); // guards a malformed parent cycle
    const result =
      !comment.deleted || (replies.get(comment.id) ?? []).some(shows);
    shown.set(comment.id, result);
    return result;
  };
  return comments.filter(shows);
}

/**
 * The thread to show: the loaded comments plus new ones that fell past the loaded pages,
 * the visible ones of those, and the top-level ones (no parent, or a parent not shown).
 */
export function commentThread<
  T extends { id: string; parentId: string | null; deleted: boolean },
>(loaded: T[], created: T[]) {
  const ids = new Set(loaded.map((comment) => comment.id));
  const comments = visibleComments([
    ...loaded,
    ...created.filter((comment) => !ids.has(comment.id)),
  ]);
  const shown = new Set(comments.map((comment) => comment.id));
  const top = comments.filter(
    (comment) => !comment.parentId || !shown.has(comment.parentId),
  );
  return { comments, top };
}
