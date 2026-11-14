/**
 * How far a post status is along the workflow, from 0 to 1, for the status icon. The open
 * (`active`) statuses fill in their list order: the first is empty. Complete and closed
 * statuses are full. An unknown status is empty.
 */
export function statusProgress(
  statuses: readonly { id: string; category: string }[],
  statusId: string | null | undefined,
) {
  const open = statuses.filter((status) => status.category === "active");
  const index = open.findIndex((status) => status.id === statusId);
  if (index !== -1) return index / open.length;
  return statuses.some((status) => status.id === statusId) ? 1 : 0;
}
