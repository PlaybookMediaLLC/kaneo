import { createHmac, randomUUID } from "node:crypto";
import { createId } from "@kaneo/ids";
import { slackConnection } from "../assistant/slack-agent.fixture";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../framework/contract";

type Seeded = Awaited<ReturnType<typeof slackConnection>>;
type Ids = { a: Seeded; b: Seeded };

/** A Slack `app_mention` for the seeded team, signed with `secret` now (or `at` seconds). */
export function slackDelivery(
  target: Seeded,
  secret = target.signingSecret,
  options: { integrationId?: string; at?: number; raw?: string } = {},
): ContractInput & { raw: string } {
  const raw =
    options.raw ??
    JSON.stringify({
      type: "event_callback",
      team_id: target.teamId,
      event_id: `Ev${randomUUID().replaceAll("-", "")}`,
      event: {
        type: "app_mention",
        user: "UASKER",
        text: "<@UBOT> what are the top requests?",
        channel: "C1",
        ts: "1700000000.000100",
      },
    });
  const timestamp = String(options.at ?? Math.floor(Date.now() / 1000));
  return {
    params: {
      type: "slack",
      integrationId: options.integrationId ?? target.integrationId,
      kind: "events",
    },
    raw,
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`,
    },
  };
}

export const receiveQuillsAppHook = fixture({
  seed: async (env: ContractEnv) => ({
    a: await slackConnection(env, env.a, true),
    b: await slackConnection(env, env.b, true),
  }),
  valid: ({ a }: Ids) => slackDelivery(a),
  forged: ({ a, b }: Ids): ContractInput[] => {
    const good = slackDelivery(a);
    return [
      {
        ...good,
        headers: { ...good.headers, "x-slack-signature": "v0=00" },
      },
      { ...good, headers: {} },
      // Older than the five-minute window, correctly signed.
      slackDelivery(a, a.signingSecret, {
        at: Math.floor(Date.now() / 1000) - 600,
      }),
      // A changed body under the original signature.
      { ...good, raw: good.raw.replace("top requests", "secrets") },
      // An integration that does not exist.
      slackDelivery(a, a.signingSecret, {
        integrationId: createId("integration"),
      }),
      // B's signing secret on A's integration.
      slackDelivery(a, b.signingSecret),
    ];
  },
  crossed: ({ a, b }: Ids) => [
    slackDelivery(a, b.signingSecret),
    // B's own valid event: it changes B only.
    slackDelivery(b),
  ],
  invalid: ({ a }: Ids): ContractInput[] =>
    ['{"type":5}', "[", '{"type":"event_callback","event":{"type":7}}'].map(
      (raw) => slackDelivery(a, a.signingSecret, { raw }),
    ),
  hidden: ({ a, b }: Ids) => [a.signingSecret, b.signingSecret, "xoxb-seeded-"],
});
