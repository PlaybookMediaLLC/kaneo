import { fixture } from "../framework/contract";
import { enablePortal } from "../portal/seed.fixture";

/** A desktop browser: the beacon drops a request without a User-Agent. */
const browser =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// A page view on A's portal. The response carries no data, so nothing of A or B can leak.
// Exported from portal/index.fixture.ts: the portal-off test covers this route too.
export const createQuillsTrack = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return { device: env.id("device") };
  },
  valid: (ids) => ({
    body: {
      url: "https://portal.example/b/ideas?utm_source=newsletter",
      surface: "portal",
      device: ids.device,
    },
    headers: { "user-agent": browser },
  }),
  hidden: () => [],
});
