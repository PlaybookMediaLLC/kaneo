import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const board = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { boardId: a.boardId } }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId }),
});

export const listQuillsBoards = fixture({
  seed,
  valid: () => ({ query: { counts: "true" } }),
});
export const getQuillsBoard = board;
export const createQuillsBoard = fixture({
  seed,
  valid: () => ({ body: { name: "Contract board", description: "Ideas" } }),
});
export const updateQuillsBoard = fixture({
  ...board,
  valid: (ids: Ids) => ({
    ...board.valid(ids),
    body: { name: "Renamed board" },
  }),
});
export const deleteQuillsBoard = board;
