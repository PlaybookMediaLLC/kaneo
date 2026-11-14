import { fixture } from "../framework/contract";
import { seed, softDeleteBoard, type Ids } from "./seed.fixture";

const board = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { boardId: a.boardId } }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId }),
  softDelete: softDeleteBoard,
});

export const getQuillsBoardSettings = board;
export const updateQuillsBoardSettings = fixture({
  ...board,
  valid: (ids: Ids) => ({
    ...board.valid(ids),
    body: { voteDisplay: "hidden", defaultSort: "random" },
  }),
});
