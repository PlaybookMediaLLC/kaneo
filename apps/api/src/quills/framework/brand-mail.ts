import {
  renderBrandedEmail,
  sendRawEmail,
  type BrandStyleInput,
  type EmailBlock,
  type RenderBrandedEmailInput,
  type RenderedBrandedEmail,
  type SendingIdentity,
} from "@kaneo/email/quills";

// Trusted framework seam for multi-brand email preview & Send Test (#332):
// no database access; routes render synchronously and send test emails in `call` outside any DB tx.

export type {
  BrandStyleInput,
  EmailBlock,
  RenderBrandedEmailInput,
  RenderedBrandedEmail,
};

export function renderBrandedEmailTemplate(
  input: RenderBrandedEmailInput,
): RenderedBrandedEmail {
  return renderBrandedEmail(input);
}

export async function sendBrandedTestEmail(params: {
  to: string;
  fromEmail?: string | null;
  replyTo?: string | null;
  fromDisplayName?: string | null;
  rendered: RenderedBrandedEmail;
}): Promise<{ sent: boolean; reason?: string }> {
  const from = (params.fromEmail?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    "noreply@kaneo.app") as SendingIdentity;
  const result = await sendRawEmail({
    from,
    ...(params.fromDisplayName?.trim()
      ? { fromDisplayName: params.fromDisplayName.trim() }
      : {}),
    to: params.to,
    subject: params.rendered.subject,
    html: params.rendered.html,
    text: params.rendered.text,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
  });
  return { sent: result.sent, reason: result.reason };
}
