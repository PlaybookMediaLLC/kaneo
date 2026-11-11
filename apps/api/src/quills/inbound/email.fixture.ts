import { createHmac, randomUUID } from "node:crypto";
import { fixture, type ContractEnv } from "../framework/contract";

// The instance's inbound mail settings for contract checks. Configured values win.
const KEY = Buffer.from("quills-contract-inbound-signing-key").toString(
  "base64",
);
process.env.EMAIL_INBOUND_SIGNING_SECRET ||= `whsec_${KEY}`;
process.env.EMAIL_INBOUND_DOMAIN ||= "inbound.example.test";

/** A Resend `email.received` delivery, Svix-signed with `secret` at `timestamp` (seconds). */
function inboundMail(
  workspaceSlug: string,
  mail: { from: string; messageId: string; text?: string; inReplyTo?: string },
  options: { secret?: string; timestamp?: number; id?: string } = {},
) {
  const raw = JSON.stringify({
    type: "email.received",
    data: {
      email_id: randomUUID(),
      from: mail.from,
      to: [`${workspaceSlug}@${process.env.EMAIL_INBOUND_DOMAIN}`],
      subject: "Help",
      text: mail.text ?? "Hello from email",
      headers: {
        "message-id": mail.messageId,
        ...(mail.inReplyTo && { "in-reply-to": mail.inReplyTo }),
      },
    },
  });
  return signed(raw, options);
}

/** Svix headers over exact bytes. */
function signed(
  raw: string,
  options: { secret?: string; timestamp?: number; id?: string } = {},
) {
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const secret = options.secret ?? process.env.EMAIL_INBOUND_SIGNING_SECRET!;
  const signature = createHmac(
    "sha256",
    Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
  )
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return {
    raw,
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  };
}

const sender = (env: ContractEnv) => {
  const label = env.id("sender").toLowerCase();
  return {
    from: `Sender <${label}@customer.example.test>`,
    messageId: `<${label}@customer.example.test>`,
  };
};

export const receiveQuillsInboundEmail = fixture({
  seed: async (env: ContractEnv) => ({ env, mail: sender(env) }),
  valid: ({
    env,
    mail,
  }: {
    env: ContractEnv;
    mail: ReturnType<typeof sender>;
  }) => inboundMail(env.a, mail),
  forged: ({
    env,
    mail,
  }: {
    env: ContractEnv;
    mail: ReturnType<typeof sender>;
  }) => {
    const good = inboundMail(env.a, mail);
    return [
      inboundMail(env.a, mail, {
        secret: `whsec_${Buffer.from("another-key").toString("base64")}`,
      }),
      inboundMail(env.a, mail, {
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      }),
      { ...good, headers: {} },
      // A changed recipient under the original signature.
      { ...good, raw: good.raw.replace(`${env.a}@`, `${env.b}@`) },
    ];
  },
  crossed: ({
    env,
    mail,
  }: {
    env: ContractEnv;
    mail: ReturnType<typeof sender>;
  }) => [
    // Mail for workspace B lands in B only.
    inboundMail(env.b, mail),
  ],
  // Correctly signed bodies that the schema or the JSON parser rejects.
  invalid: ({ env }: { env: ContractEnv; mail: ReturnType<typeof sender> }) =>
    [
      "not json",
      JSON.stringify({
        type: 5,
        data: { to: [`${env.a}@${process.env.EMAIL_INBOUND_DOMAIN}`] },
      }),
    ].map((raw) => signed(raw)),
  hidden: () => [process.env.EMAIL_INBOUND_SIGNING_SECRET!, KEY],
});
