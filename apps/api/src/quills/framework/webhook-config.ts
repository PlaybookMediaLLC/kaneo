import { changeSchema } from "../events";

// Trusted for Quills route modules: no database access and no delivery.
// Reuses the instance webhook checks: a public HTTPS target after DNS resolution, and an encrypted signing secret.
export { newSigningSecret } from "../../admin/webhooks/new-signing-secret";
export { validateWebhookUrl } from "../../admin/webhooks/validate-webhook-url";
/** The event catalogue a webhook may subscribe to. */
export const webhookEvent = changeSchema.shape.type;
