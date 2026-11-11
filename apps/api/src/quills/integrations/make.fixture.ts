import { fixture } from "../framework/contract";
import "./seed.fixture";

export const saveQuillsMakeWebhook = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { webhookUrl: "https://hook.eu1.make.com/contract" },
  }),
});
