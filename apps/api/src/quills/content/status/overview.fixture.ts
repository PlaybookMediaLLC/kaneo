import { fixture } from "../../framework/contract";
import { all, seed, type Ids } from "./seed.fixture";

export const getQuillsStatusSummary = all;
export const getQuillsStatusUptime = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    query: { componentIds: `${a.componentId},${a.otherComponentId}` },
  }),
});
export const clearQuillsStatusHistory = all;
