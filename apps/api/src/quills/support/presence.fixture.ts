import { empty, fixture } from "../framework/contract";
import { enablePortal } from "../portal/customer-seed.fixture";
import { sharedRows } from "./customer/seed.fixture";

export const sendQuillsAgentHeartbeat = empty;

/** The portal on in A. The answer is two booleans, so no customer's or workspace B's text may appear. */
export const getQuillsConversationPresence = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return sharedRows(env);
  },
  valid: () => ({}),
  own: () => [],
  hidden: (rows) => [
    rows.otherName,
    rows.other.text.visitor,
    rows.foreign.text.visitor,
  ],
});
