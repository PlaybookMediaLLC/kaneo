import { fixture } from "../../framework/contract";
import { all, seed, type Ids } from "./seed.fixture";

export const listQuillsStatusSubscribers = all;
export const exportQuillsStatusSubscribers = all;
export const addQuillsStatusSubscriber = fixture({
  seed,
  valid: ({ a }: Ids) => ({ body: { email: a.email } }),
});
export const importQuillsStatusSubscribers = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: { emails: [a.email, "nobody@example.test"] },
  }),
});
export const removeQuillsStatusSubscriber = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { principalId: a.principalId } }),
  foreign: ({ b }: Ids) => ({ principalId: b.principalId }),
});
