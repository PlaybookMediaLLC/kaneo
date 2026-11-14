import type { ListStatusesResponse } from "../../api/team/list-statuses";

type Status = ListStatusesResponse["statuses"][number];

/**
 * The status moves of the floating action bar. `next` is the next open or complete status in
 * order (the first one for a post without a status); `accept` is true when the post is at the
 * first status, so the main button says "Accept". `close` is the first closed status.
 */
export function statusMoves(
  statuses: readonly Status[],
  currentId: string | null,
) {
  const ordered = [...statuses].sort((a, b) => a.position - b.position);
  const flow = ordered.filter((status) => status.category !== "closed");
  const index = flow.findIndex((status) => status.id === currentId);
  const close = ordered.find((status) => status.category === "closed");
  return {
    next:
      currentId === null ? flow[0] : index === -1 ? undefined : flow[index + 1],
    accept: index === 0,
    close: close?.id === currentId ? undefined : close,
  };
}
