import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const onWorkflow = (extra: (ids: Ids) => object = () => ({})) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({
      params: { workflowId: ids.a.workflowId },
      ...extra(ids),
    }),
    foreign: (ids: Ids) => ({ workflowId: ids.b.workflowId }),
  });

export const listQuillsWorkflows = fixture({ seed, valid: () => ({}) });
export const getQuillsWorkflow = onWorkflow();
export const createQuillsWorkflow = fixture({
  seed,
  valid: (ids: Ids) => ({
    body: {
      name: "Tag closed conversations",
      triggerType: "conversation.status_changed",
      graph: ids.a.graph,
    },
  }),
});
export const updateQuillsWorkflow = onWorkflow(() => ({
  body: { name: "Renamed workflow" },
}));
export const deleteQuillsWorkflow = onWorkflow();
export const reorderQuillsWorkflows = fixture({
  seed,
  valid: (ids: Ids) => ({ body: { workflowIds: [...ids.a.order].reverse() } }),
});
export const publishQuillsWorkflow = onWorkflow();
export const pauseQuillsWorkflow = onWorkflow();
export const listQuillsWorkflowVersions = onWorkflow();
export const restoreQuillsWorkflowVersion = fixture({
  seed,
  valid: (ids: Ids) => ({
    params: { workflowId: ids.a.workflowId, versionId: ids.a.versionId },
  }),
  foreign: (ids: Ids) => ({
    workflowId: ids.b.workflowId,
    versionId: ids.b.versionId,
  }),
});
