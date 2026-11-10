import { fixture } from "../../framework/contract";
import { all, by, seed, twoComponents, type Ids } from "./seed.fixture";

export const listQuillsStatusComponents = all;
export const getQuillsStatusComponent = by("componentId");
export const createQuillsStatusComponent = fixture({
  seed,
  valid: ({ a }: Ids) => ({ body: { name: "Database", groupId: a.groupId } }),
  foreign: ({ b }: Ids) => ({ groupId: b.groupId }),
});
export const updateQuillsStatusComponent = by("componentId", undefined, {
  status: "major_outage",
});
export const deleteQuillsStatusComponent = by("componentId");
export const reorderQuillsStatusComponents = fixture({
  seed: twoComponents,
  valid: (componentIds: string[]) => ({ body: { componentIds } }),
});
