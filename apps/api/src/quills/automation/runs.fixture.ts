import { empty, fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

export const listQuillsRunnableWorkflows = fixture({ seed, valid: () => ({}) });
export const runQuillsWorkflowManually = fixture({
  seed,
  valid: (ids: Ids) => ({
    params: { workflowId: ids.a.workflowId },
    body: { conversationId: ids.a.conversationId },
  }),
  foreign: (ids: Ids) => ({
    workflowId: ids.b.workflowId,
    conversationId: ids.b.conversationId,
  }),
});
export const previewQuillsWorkflow = fixture({
  seed,
  valid: (ids: Ids) => ({
    params: { workflowId: ids.a.workflowId },
    query: { conversationId: ids.a.conversationId },
  }),
  foreign: (ids: Ids) => ({
    workflowId: ids.b.workflowId,
    conversationId: ids.b.conversationId,
  }),
});
export const listQuillsWorkflowRuns = fixture({
  seed,
  valid: (ids: Ids) => ({ params: { workflowId: ids.a.workflowId } }),
  foreign: (ids: Ids) => ({ workflowId: ids.b.workflowId }),
});
export const listQuillsWorkflowRunEvents = fixture({
  seed,
  valid: (ids: Ids) => ({ params: { runId: ids.a.runId } }),
  foreign: (ids: Ids) => ({ runId: ids.b.runId }),
});
export const getQuillsWorkflowEffectiveness = empty;
