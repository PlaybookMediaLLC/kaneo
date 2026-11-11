import { fixture } from "../framework/contract";
import { enableWidget, pairingCode } from "./seed.fixture";

export const redeemQuillsWidgetInstallCode = fixture({
  seed: async (env) => {
    await enableWidget(env, env.a);
    return {
      code: await pairingCode(env, env.a),
      foreignSecret: await enableWidget(env, env.b),
    };
  },
  valid: (ids) => ({ body: { code: ids.code } }),
  hidden: (ids) => [ids.foreignSecret],
});
