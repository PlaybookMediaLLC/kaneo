import { fixture } from "../framework/contract";
import "./seed.fixture";

export const saveQuillsZapierWebhook = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { webhookUrl: "https://hooks.zapier.com/hooks/catch/1/contract/" },
  }),
});
