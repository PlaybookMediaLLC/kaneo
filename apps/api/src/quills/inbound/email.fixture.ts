import { createHmac, randomUUID } from "node:crypto";
import { emailLog } from "../../database/quills/schema/email-log";
import { fixture, type ContractEnv } from "../framework/contract";
import { mailTags } from "../framework/signed";

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

/** A Resend delivery event for a mail whose tags the mail worker signed (`mailTags`). */
function deliveryEvent(
  tags: { name: string; value: string }[],
  type = "email.bounced",
  options: { secret?: string; timestamp?: number } = {},
) {
  const raw = JSON.stringify({
    type,
    data: {
      email_id: randomUUID(),
      tags: Object.fromEntries(tags.map((tag) => [tag.name, tag.value])),
    },
  });
  return signed(raw, options);
}

/** One outbound log row in `workspaceId` and the tags its send carried. */
async function sentMail(env: ContractEnv, workspaceId: string) {
  const [row] = await env.scoped(workspaceId, (db) =>
    db
      .insert(emailLog)
      .values({
        direction: "outbound",
        emailType: "ConversationReplyEmail",
        address: "customer@example.test",
        status: "sent",
      })
      .returning({ id: emailLog.id }),
  );
  return mailTags(workspaceId, row!.id);
}
type Sent = { a: Awaited<ReturnType<typeof sentMail>>; b: Sent["a"] };

export const receiveQuillsEmailDeliveryEvent = fixture({
  seed: async (env: ContractEnv) => ({
    a: await sentMail(env, env.a),
    b: await sentMail(env, env.b),
  }),
  valid: ({ a }: Sent) => deliveryEvent(a),
  forged: ({ a, b }: Sent) => {
    const good = deliveryEvent(a);
    return [
      deliveryEvent(a, "email.bounced", {
        secret: `whsec_${Buffer.from("another-key").toString("base64")}`,
      }),
      deliveryEvent(a, "email.bounced", {
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      }),
      { ...good, headers: {} },
      // Workspace B's log row under A's signature.
      { ...good, raw: good.raw.replace(a[1]!.value, b[1]!.value) },
    ];
  },
  crossed: ({ a, b }: Sent) => [
    // B's mail changes B only; A's log row with B's workspace fails the tag signature (404).
    deliveryEvent(b),
    deliveryEvent([
      { name: "kaneo_workspace", value: b[0]!.value },
      ...a.slice(1),
    ]),
  ],
  invalid: ({ a }: Sent) =>
    [
      "not json",
      JSON.stringify({
        type: 5,
        data: { tags: Object.fromEntries(a.map((t) => [t.name, t.value])) },
      }),
    ].map((raw) => signed(raw)),
  hidden: () => [process.env.EMAIL_INBOUND_SIGNING_SECRET!, KEY],
});
