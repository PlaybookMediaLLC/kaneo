import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { defineQuillsRoute } from "../framework/define-route";
import { slackHook } from "../framework/signed";

// POST /quills-public/signed/integrations/slack/{integrationId}/hooks/events: the Slack Events API
// for the assistant. framework/signed.ts checks the signature with the signing secret of the
// workspace's Slack app; the workspace is the integration's. While the assistant is on, a mention
// of the app or a direct message to it, from a person in the connected Slack team, is kept in
// kv_store for one day and recorded as integration.hook_received. The quills.ai worker answers it
// (assistant/engine/slack.ts). The message text never enters the event or the audit row.

const HOOK_TTL_MS = 86_400_000;
/** The kv_store key of a stored question. Slack event IDs are letters and digits. */
export const slackHookKey = (eventId: string) => `slack-hook:${eventId}`;
const slackId = z.string().max(100);

const receive = defineQuillsRoute({
  audience: "signed",
  verifier: slackHook,
  method: "post",
  path: "/integrations/{type}/{integrationId}/hooks/{kind}",
  operationId: "receiveQuillsAppHook",
  summary: "Receive a Slack app event for the assistant",
  description:
    "Slack signs the body (x-slack-signature, x-slack-request-timestamp; five minutes). Answers the URL verification challenge. A repeated event changes nothing.",
  action: "create",
  params: z.object({
    type: z.enum(["slack"]),
    integrationId: z.string().regex(/^integration_[0-9a-z]{26}$/),
    kind: z.enum(["events"]),
  }),
  body: z.object({
    type: z.string().max(64),
    challenge: z.string().max(500).optional(),
    team_id: slackId.optional(),
    event_id: z
      .string()
      .regex(/^[A-Za-z0-9]{1,100}$/)
      .optional(),
    event: z
      .object({
        type: z.string().max(64),
        user: slackId.optional(),
        text: z.string().max(40_000).optional(),
        channel: slackId.optional(),
        channel_type: z.string().max(32).optional(),
        ts: slackId.optional(),
        thread_ts: slackId.optional(),
        bot_id: slackId.optional(),
        subtype: z.string().max(64).optional(),
      })
      .optional(),
  }),
  response: z.object({
    challenge: z.string().nullable(),
    accepted: z.boolean(),
  }),
  responseDescription:
    "The URL verification challenge, or whether the assistant will answer the event",
  replay: { challenge: null, accepted: false },
  event: ({ params, body }, result) =>
    result.accepted && {
      type: "integration.hook_received",
      entityType: "integration",
      entityId: params.integrationId,
      payload: { provider: "slack", hook: slackHookKey(body.event_id!) },
    },
  handler: async ({ db, body, credential }) => {
    const ignored = { challenge: null, accepted: false };
    if (body.type === "url_verification")
      return { challenge: body.challenge ?? "", accepted: false };
    const event = body.event;
    const config = credential.config;
    // The installation's own team only: a valid signature does not make another team's event ours.
    if (
      body.type !== "event_callback" ||
      !body.event_id ||
      !event ||
      !body.team_id ||
      body.team_id !== config.teamId ||
      event.bot_id ||
      event.subtype ||
      !event.user ||
      event.user === config.botUserId ||
      !event.channel ||
      !event.ts ||
      !event.text?.trim() ||
      !(
        event.type === "app_mention" ||
        (event.type === "message" && event.channel_type === "im")
      )
    )
      return ignored;
    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    if (row?.config?.agents?.workspace?.slack?.enabled !== true) return ignored;
    await db
      .insert(kvStore)
      .values({
        workspaceKey: "_",
        key: slackHookKey(body.event_id),
        value: {
          team: body.team_id,
          channel: event.channel,
          user: event.user,
          ts: event.ts,
          threadTs: event.thread_ts ?? null,
          text: event.text.slice(0, 4000),
        },
        expiresAt: new Date(Date.now() + HOOK_TTL_MS),
      })
      .onConflictDoNothing();
    return { challenge: null, accepted: true };
  },
});

export default apiRouter().openapi(...receive);
