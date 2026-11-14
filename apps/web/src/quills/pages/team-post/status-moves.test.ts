import { describe, expect, it } from "vite-plus/test";
import { listStatusesFixture } from "../../api/team/list-statuses.fixture";
import { statusMoves } from "./status-moves";

const status = (
  id: string,
  category: "active" | "complete" | "closed",
  position: number,
) => ({
  id,
  name: id,
  slug: id,
  color: "gray",
  category,
  position,
  showOnRoadmap: false,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const statuses = listStatusesFixture.ok({
  statuses: [
    status("done", "complete", 2),
    status("closed", "closed", 3),
    status("open", "active", 0),
    status("planned", "active", 1),
  ],
}).statuses;
const ids = (moves: ReturnType<typeof statusMoves>) => ({
  next: moves.next?.id,
  accept: moves.accept,
  close: moves.close?.id,
});

describe("statusMoves", () => {
  it("accepts the first status and moves a later one to the next in order", () => {
    expect(ids(statusMoves(statuses, "open"))).toEqual({
      next: "planned",
      accept: true,
      close: "closed",
    });
    expect(ids(statusMoves(statuses, "planned"))).toEqual({
      next: "done",
      accept: false,
      close: "closed",
    });
  });

  it("has no next status after the last one or for a closed post", () => {
    expect(ids(statusMoves(statuses, "done")).next).toBeUndefined();
    expect(ids(statusMoves(statuses, "closed"))).toEqual({
      next: undefined,
      accept: false,
      close: undefined,
    });
  });

  it("starts a post without a status at the first status", () => {
    expect(ids(statusMoves(statuses, null)).next).toBe("open");
    expect(ids(statusMoves(statuses, "gone")).next).toBeUndefined();
  });
});
