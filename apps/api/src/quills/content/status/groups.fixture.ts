import { fixture } from "../../framework/contract";
import { by, oneGroupSet, seed } from "./seed.fixture";

export const createQuillsStatusGroup = fixture({
  seed,
  valid: () => ({ body: { name: "Infrastructure" } }),
});
export const updateQuillsStatusGroup = by("groupId", undefined, {
  collapsed: true,
});
export const deleteQuillsStatusGroup = by("groupId");
export const reorderQuillsStatusGroups = fixture({
  seed: oneGroupSet,
  valid: (groupIds: string[]) => ({ body: { groupIds } }),
});
