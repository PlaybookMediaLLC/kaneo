import { empty, fixture, type ContractEnv } from "../framework/contract";
import { pendingInvite } from "./customer-seed.fixture";

const both = async (env: ContractEnv) => ({
  a: await pendingInvite(env, env.a),
  b: await pendingInvite(env, env.b),
});
type Ids = Awaited<ReturnType<typeof both>>;
const byId = fixture({
  seed: both,
  valid: ({ a }: Ids) => ({ params: { inviteId: a.inviteId } }),
  foreign: ({ b }: Ids) => ({ inviteId: b.inviteId }),
});

export const sendQuillsPortalInvite = fixture({
  seed: async (env) => ({ email: `${env.id("invitee")}@example.test` }),
  valid: ({ email }) => ({ body: { email, message: "Welcome aboard" } }),
});
export const listQuillsPortalInvites = empty;
export const resendQuillsPortalInvite = byId;
export const cancelQuillsPortalInvite = byId;
export const createQuillsPortalInviteLink = byId;
