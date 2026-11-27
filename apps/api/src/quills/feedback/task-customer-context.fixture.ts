import { fixture } from "../framework/contract";
import { seed, type Ids } from "./post-tasks.fixture";

export const getQuillsTaskCustomerContext = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { taskId: a.taskId } }),
  foreign: ({ b }: Ids) => ({ taskId: b.taskId }),
});
