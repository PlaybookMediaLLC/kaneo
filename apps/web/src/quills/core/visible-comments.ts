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
