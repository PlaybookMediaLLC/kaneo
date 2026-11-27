import { fixture } from "../framework/contract";
import { enableWidget, signIdentity } from "./seed.fixture";

export const verifyQuillsWidgetToken = fixture({
  seed: async (env) => {
    const secret = await enableWidget(env, env.a);
    const foreignSecret = await enableWidget(env, env.b);
    const label = env.id("verify");
    const claims = {
      sub: label,
      email: `${label}@example.test`,
      name: label,
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    return { secret, foreignSecret, claims };
  },
  valid: (ids) => ({
    body: {
      ssoToken: signIdentity(ids.claims, ids.secret),
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
  hidden: (ids) => [ids.secret, ids.foreignSecret],
});
