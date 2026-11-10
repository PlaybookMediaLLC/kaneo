import { fixture } from "../framework/contract";
import "./seed.fixture";

/** A TEST-NET-3 literal: a public address that needs no DNS lookup. */
export const saveQuillsN8nWebhook = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { webhookUrl: "https://203.0.113.10/webhook/contract" },
  }),
});
