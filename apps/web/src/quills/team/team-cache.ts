/**
 * True for a cached quills-web query of another workspace or another user.
 * Framework keys start with ["quills", workspaceId, viewerId].
 */
export function isOtherQuillsScope(
  queryKey: readonly unknown[],
  workspaceId: string,
  userId: string,
) {
  return (
    queryKey[0] === "quills" &&
    (queryKey[1] !== workspaceId || queryKey[2] !== userId)
  );
}
