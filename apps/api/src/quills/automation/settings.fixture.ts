import { empty, fixture } from "../framework/contract";

const body = (value: object) =>
  fixture({ seed: async () => ({}), valid: () => ({ body: value }) });

export const getQuillsWorkflowAbandonedAutoClose = empty;
export const setQuillsWorkflowAbandonedAutoClose = body({
  enabled: true,
  waitMinutes: 10,
});
export const getQuillsWorkflowCloseSpam = empty;
export const setQuillsWorkflowCloseSpam = body({ enabled: true });
