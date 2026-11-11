import { fixture } from "../framework/contract";
import { on, seedFor } from "./seed.fixture";

export const listQuillsAssistantPendingActions = fixture({
  seed: seedFor("conversation"),
  valid: () => ({ query: { status: "proposed" } }),
});
const onAction = () =>
  on(
    ["conversation"],
    (a) => ({ params: { actionId: a.actionId } }),
    (b) => ({ actionId: b.actionId }),
  );
export const getQuillsAssistantPendingAction = onAction();
export const approveQuillsAssistantAction = onAction();
export const rejectQuillsAssistantAction = onAction();
