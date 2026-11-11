import { fixture } from "../framework/contract";

// A fresh registration token per request, so each check registers a new device.
export const registerQuillsPushDevice = fixture({
  seed: async (env) => ({ token: env.id("push") }),
  valid: ({ token }) => ({ body: { token, platform: "ios" } }),
});

export const unregisterQuillsPushDevice = fixture({
  seed: async (env) => ({ token: env.id("push") }),
  valid: ({ token }) => ({ body: { token } }),
});
