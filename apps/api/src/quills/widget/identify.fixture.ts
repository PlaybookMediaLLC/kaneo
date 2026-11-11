import { conversations } from "../../database/quills/schema/conversation";
import { fixture } from "../framework/contract";
import { anonymousVisitor } from "./contact-email.fixture";
import { enableWidget, signIdentity } from "./seed.fixture";

export const identifyQuillsWidgetVisitor = fixture({
  seed: async (env) => {
    const secret = await enableWidget(env, env.a);
    const foreignSecret = await enableWidget(env, env.b);
    const label = env.id("identify");
    const claims = {
      sub: label,
      email: `${label}@example.test`,
      name: label,
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    // An anonymous session with a conversation: the authorized request merges it (previousToken),
    // so the rollback and outbox checks cover the merge writes.
    const anonymous = await anonymousVisitor(env, env.a);
    await env.scoped(env.a, (db) =>
      db.insert(conversations).values({
        visitorPrincipalId: anonymous.principalId,
        channel: "messenger",
      }),
    );
    return {
      secret,
      foreignSecret,
      claims,
      anonymous: anonymous.token,
      anonymousPrincipalId: anonymous.principalId,
    };
  },
  // The merge ends the Bearer's session, so the audit actor (the caller) is read from the seed.
  actor: async (_env, ids) => ids.anonymousPrincipalId,
  valid: (ids) => ({
    bearer: ids.anonymous,
    body: {
      ssoToken: signIdentity(ids.claims, ids.secret),
      previousToken: ids.anonymous,
    },
  }),
  forged: (ids) => [
    { body: { ssoToken: signIdentity(ids.claims, `${ids.secret}x`) } },
    { body: { ssoToken: signIdentity(ids.claims, ids.foreignSecret) } },
    { body: { ssoToken: signIdentity(ids.claims, ids.secret, "none") } },
    {
      body: {
        ssoToken: signIdentity({ ...ids.claims, exp: undefined }, ids.secret),
      },
    },
    {
      body: {
        ssoToken: signIdentity(
          { ...ids.claims, exp: Math.floor(Date.now() / 1000) - 1 },
          ids.secret,
        ),
      },
    },
  ],
  // The audit row names the anonymous session's principal (the Bearer); the event names the visitor.
  hidden: (ids) => [ids.secret, ids.foreignSecret, ids.anonymous],
});
