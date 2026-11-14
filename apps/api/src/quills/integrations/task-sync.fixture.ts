import { fixture } from "../framework/contract";
import { seed, softDeleteBoard, type Ids } from "../feedback/seed.fixture";

const board = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { boardId: a.boardId } }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId }),
  softDelete: softDeleteBoard,
});

export const getQuillsBoardTaskSync = board;
export const setQuillsBoardTaskSync = fixture({
  ...board,
  valid: (ids: Ids) => ({
    ...board.valid(ids),
    body: { statusOnTaskDone: ids.a.otherStatusId },
  }),
  foreign: ({ b }: Ids) => ({
    boardId: b.boardId,
    statusOnTaskDone: b.otherStatusId,
  }),
});
