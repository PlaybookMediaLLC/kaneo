import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  withQuillsSystemWorkspace,
  withQuillsWorkspace,
} from "../../../database/quills/client";
import { principal, settings } from "../../../database/quills/schema/auth";
import { integrations } from "../../../database/quills/schema/integrations";
import { kvStore } from "../../../database/quills/schema/kv";
import { slackUserLinks } from "../../../database/quills/schema/slack";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
} from "../../framework/integration-config";
import {
  memberByVerifiedEmail,
  memberQuillsActions,
} from "../../framework/platform-reads";
import { claimDelivery, settleDelivery } from "../../jobs/ledger";
import { AiError, chatJson, untrusted } from "../provider";
import { logUsage, type UsageEntry } from "../runs";
import { readConfig } from "../settings";
import { formatSources, searchArticles, searchKnowledge } from "./retrieval";
import { failedUsage, nothing, type Work } from "./shared";

// integration.hook_received (Slack): one answer in the thread of a mention or a direct message that
// the signed hook stored (integrations/slack-hook.ts). The asker must be a teammate who holds
// quills:read now: the Slack user that slack_user_links names, or, on first contact, the one current
// member whose verified account email is the Slack profile email (then linked, never rebound). The
// answer comes from the help center and the knowledge at the team ceiling, with one provider call
// and no tools. The hook_deliveries receipt is written before the Slack call, so a rerun, a lost
// lease or an expired lease never posts twice; an attempt that stopped after its claim is uncertain
// and is not posted again.

const hookSchema = z.object({
  team: z.string(),
  channel: z.string(),
  user: z.string(),
  ts: z.string(),
  threadTs: z.string().nullable(),
  text: z.string(),
});
type Hook = z.infer<typeof hookSchema>;
const NOT_A_TEAMMATE =
  "I can only answer teammates of this workspace. Sign in to Kaneo with the email that you use in Slack, then ask again.";

/** Slack mrkdwn treats `<`, `>` and `&` as control characters: model text cannot mention anyone. */
const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slackHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json; charset=utf-8",
});

/** The confirmed profile email of a Slack person, or null for a bot, a deleted account or no email. */
async function profileEmail(token: string, user: string) {
  const answer = (await providerJson(
    `https://slack.com/api/users.info?user=${encodeURIComponent(user)}`,
    { headers: { authorization: `Bearer ${token}` } },
  )) as {
    ok?: unknown;
    user?: {
      deleted?: unknown;
      is_bot?: unknown;
      profile?: { email?: unknown };
    };
  } | null;
  const person = answer?.user;
  return answer?.ok === true &&
    !person?.deleted &&
    !person?.is_bot &&
    typeof person?.profile?.email === "string"
    ? person.profile.email
    : null;
}

/** Posts one message for the hook, behind its receipt. */
async function post(
  workspaceId: string,
  key: string,
  token: string,
  hook: Hook,
  text: string,
  ephemeral: boolean,
) {
  const claim = await withQuillsSystemWorkspace(workspaceId, (db) =>
    claimDelivery(db, key, "slack_answer"),
  );
  if (claim !== "send") return;
  let outcome: "completed" | "failed" | "uncertain";
  try {
    const answer = (await providerJson(
      `https://slack.com/api/${ephemeral ? "chat.postEphemeral" : "chat.postMessage"}`,
      {
        method: "POST",
        headers: slackHeaders(token),
        body: JSON.stringify({
          channel: hook.channel,
          ...(ephemeral && { user: hook.user }),
          thread_ts: hook.threadTs ?? hook.ts,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      },
    )) as { ok?: unknown } | null;
    // Slack answers 200 with ok: false when it refuses a message: nothing was posted.
    outcome = answer?.ok === true ? "completed" : "failed";
  } catch (error) {
    if (!(error instanceof ProviderCallError)) throw error;
    outcome =
      error.status === null || error.status >= 500 ? "uncertain" : "failed";
  }
  // Its own transaction, so a lease lost later cannot erase what happened.
  await withQuillsSystemWorkspace(workspaceId, (db) =>
    settleDelivery(db, key, outcome),
  );
}

export const answerSlackHook: Work = async (workspaceId, event) => {
  const payload = event.payload as { provider?: unknown; hook?: unknown };
  if (payload.provider !== "slack" || typeof payload.hook !== "string")
    return nothing;
  const hookKey = payload.hook;
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [stored] = await db
      .select({ value: kvStore.value })
      .from(kvStore)
      .where(
        and(
          eq(kvStore.workspaceKey, "_"),
          eq(kvStore.key, hookKey),
          gt(kvStore.expiresAt, new Date()),
        ),
      );
    const hook = hookSchema.safeParse(stored?.value).data;
    const [row] = await db
      .select({ config: settings.assistantConfig })
      .from(settings)
      .limit(1);
    const [slack] = await db
      .select({
        status: integrations.status,
        config: integrations.config,
        secrets: integrations.secrets,
      })
      .from(integrations)
      .where(eq(integrations.integrationType, "slack"));
    const token = openCredentials(slack?.secrets ?? null)?.accessToken;
    // The switch, the connection and its team are read again: any may have changed since the hook.
    if (
      !hook ||
      !token ||
      row?.config?.agents?.workspace?.slack?.enabled !== true ||
      slack?.status !== "active" ||
      (slack.config as { teamId?: unknown }).teamId !== hook.team
    )
      return undefined;
    const [link] = await db
      .select({ userId: principal.kaneoUserId })
      .from(slackUserLinks)
      .innerJoin(principal, eq(principal.id, slackUserLinks.principalId))
      .where(
        and(
          eq(slackUserLinks.slackTeamId, hook.team),
          eq(slackUserLinks.slackUserId, hook.user),
        ),
      );
    return { hook, token, config: readConfig(row.config), link };
  });
  if (!context) return nothing;
  const { hook, token, config } = context;
  const key = `slack-answer:${hookKey}`;
  // An existing link decides, even for a former member: it never rebinds to another account.
  let userId = context.link ? context.link.userId : undefined;
  if (!context.link) {
    const email = await profileEmail(token, hook.user);
    const found = email && (await memberByVerifiedEmail(workspaceId, email));
    if (found) {
      await withQuillsWorkspace(
        { workspaceId, userId: found },
        async (db, actor) => {
          await db
            .insert(slackUserLinks)
            .values({
              slackTeamId: hook.team,
              slackUserId: hook.user,
              principalId: actor.principalId,
              method: "email",
            })
            .onConflictDoNothing();
        },
      );
      userId = found;
    }
  }
  if (
    !userId ||
    !(await memberQuillsActions(workspaceId, userId)).includes("read")
  ) {
    await post(workspaceId, key, token, hook, NOT_A_TEAMMATE, true);
    return nothing;
  }
  const question = hook.text
    .replace(/<@[A-Z0-9]+>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const usage: UsageEntry[] = [];
  let text: string;
  try {
    const sources = await withQuillsSystemWorkspace(workspaceId, async (db) => [
      ...(config.copilot.knowledge.helpCenter
        ? await searchArticles(db, question, "team")
        : []),
      ...(await searchKnowledge(
        db,
        question,
        "team",
        config.copilot.knowledge.documents,
      )),
    ]);
    const { value, usage: callUsage } = await chatJson(
      z.object({ text: z.string().min(1).max(3000) }),
      [
        {
          role: "system",
          content: `You are ${config.identity.name}, an assistant that answers a teammate's question in Slack. Answer only from the sources below; when they do not answer the question, say so. Answer with one JSON object: {"text": string}.`,
        },
        {
          role: "system",
          content: untrusted(
            "sources",
            sources.length ? formatSources(sources) : "No sources.",
          ),
        },
        { role: "user", content: untrusted("question", question || "Hello") },
      ],
      1200,
    );
    usage.push({
      step: "slack_answer",
      callType: "chat_completion",
      usage: callUsage,
    });
    text = `${escape(value.text)}\n_AI-generated · ${escape(config.identity.name)}_`;
  } catch (error) {
    // failedUsage rethrows anything but a provider failure: the job then retries, and nothing was posted.
    usage.push(failedUsage("slack_answer", "chat_completion", error));
    text =
      error instanceof AiError && error.code.endsWith("not_configured")
        ? "AI is not configured for this workspace."
        : "Something went wrong on my side. Try again in a moment.";
  }
  await post(workspaceId, key, token, hook, text, false);
  return (db) => logUsage(db, usage);
};
