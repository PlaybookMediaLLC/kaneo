import { fixture } from "../framework/contract";
import { enablePortal } from "../portal/customer-seed.fixture";
import { callerOf, sharedRows } from "./customer/seed.fixture";

// A loopback URL: the guard refuses it before any connection, so a contract run never leaves the
// machine. support/link-preview.test.ts covers the fetch and the refusals.
const query = { url: "http://127.0.0.1:9/contract" };
const hidden = (rows: Awaited<ReturnType<typeof sharedRows>>) => [
  rows.otherName,
  rows.other.text.visitor,
  rows.foreign.text.visitor,
];

export const unfurlQuillsLink = fixture({
  seed: async () => ({}),
  valid: () => ({ query }),
});
export const unfurlQuillsPortalLink = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return sharedRows(env);
  },
  valid: () => ({ query }),
  own: () => [],
  hidden,
});
export const unfurlQuillsWidgetLink = fixture({
  seed: async (env) => ({
    rows: await sharedRows(env),
    caller: await callerOf(env, "widget"),
  }),
  valid: (w) => ({ query, bearer: w.caller.bearer }),
  hidden: (w) => hidden(w.rows),
});
