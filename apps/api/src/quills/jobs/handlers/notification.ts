import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { typeIdSchema } from "@kaneo/ids/zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { integrations } from "../../../database/quills/schema/integrations";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { inAppNotifications } from "../../../database/quills/schema/notifications";
import { pushDevices } from "../../../database/quills/schema/push-devices";
import { slackUserLinks } from "../../../database/quills/schema/slack";
import { decryptSecret } from "../../../notification-preferences/secrets";
import { sendOutboundRequest } from "../../../utils/outbound-request";
import {
  openCredentials,
  providerJson,
} from "../../framework/integration-config";
import { loadEvent, subscribers } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";
import { wants } from "../preferences";
import { finishQuillsJob } from "../queue";

export const notificationPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    principalId: typeIdSchema("principal"),
  })
  .strict();

interface OutboundSideEffects {
  title: string;
  body: string | null;
  type: string;
  slack?: { botToken: string; slackUserId: string };
  pushDevices: { token: string; platform: string }[];
}

function escapeSlackMrkdwn(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Writes one in-app notification row and dispatches optional Slack DM / Push notifications
 * outside the database transaction (#321).
 */
export async function runNotificationJob(
  workspaceId: string,
  job: JobQueueRow,
) {
  const { eventId, principalId } = notificationPayloadSchema.parse(job.payload);
  const key = `notification:${eventId}:${principalId}`;
  let outbound: OutboundSideEffects | undefined;

  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const claimed = await claimDelivery(db, key, "notification");
    if (claimed === "send") {
      const event = await loadEvent(db, eventId);
      const content =
        event && (await subscribers[event.type]?.notification?.(db, event));
      if (content) {
        const [wantsInApp, wantsSlack, wantsPush] = await Promise.all([
          wants(db, principalId, content.type, "inApp"),
          wants(db, principalId, content.type, "slackDm"),
          wants(db, principalId, content.type, "push"),
        ]);

        if (wantsInApp) {
          await db.insert(inAppNotifications).values({
            principalId,
            type: content.type,
            title: content.title,
            body: content.body ?? null,
            postId: content.postId ?? null,
            commentId: content.commentId ?? null,
          });
        }

        let slack: OutboundSideEffects["slack"];
        if (wantsSlack) {
          const [link] = await db
            .select({ slackUserId: slackUserLinks.slackUserId })
            .from(slackUserLinks)
            .where(eq(slackUserLinks.principalId, principalId))
            .limit(1);
          if (link?.slackUserId) {
            const [slackInt] = await db
              .select({ secrets: integrations.secrets })
              .from(integrations)
              .where(
                and(
                  eq(integrations.integrationType, "slack"),
                  eq(integrations.status, "active"),
                ),
              )
              .limit(1);
            const creds = openCredentials(slackInt?.secrets ?? null);
            const rawToken =
              (typeof creds?.botToken === "string" ? creds.botToken : null) ??
              (typeof creds?.accessToken === "string"
                ? creds.accessToken
                : null);
            if (rawToken) {
              slack = { botToken: rawToken, slackUserId: link.slackUserId };
            }
          }
        }

        const devices: OutboundSideEffects["pushDevices"] = [];
        if (wantsPush) {
          const rows = await db
            .select({
              tokenEncrypted: pushDevices.tokenEncrypted,
              platform: pushDevices.platform,
            })
            .from(pushDevices)
            .where(
              and(
                eq(pushDevices.principalId, principalId),
                isNotNull(pushDevices.tokenEncrypted),
              ),
            )
            .limit(10);
          for (const row of rows) {
            if (!row.tokenEncrypted) continue;
            try {
              const plain = decryptSecret(row.tokenEncrypted);
              if (plain) devices.push({ token: plain, platform: row.platform });
            } catch {
              // Skip unreadable/rotated ciphertext without rolling back in-app notification.
            }
          }
        }

        if (slack || devices.length > 0) {
          outbound = {
            title: content.title,
            body: content.body ?? null,
            type: content.type,
            slack,
            pushDevices: devices,
          };
        }
      }
      await settleDelivery(db, key, "completed");
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });

  // Best-effort external Slack DM & Push delivery strictly outside the DB transaction.
  if (outbound) {
    const effects = outbound as OutboundSideEffects;
    if (effects.slack) {
      try {
        const safeTitle = escapeSlackMrkdwn(effects.title);
        const safeBody = effects.body ? escapeSlackMrkdwn(effects.body) : null;
        await providerJson(
          "https://slack.com/api/chat.postMessage",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${effects.slack.botToken}`,
            },
            body: JSON.stringify({
              channel: effects.slack.slackUserId,
              text: safeBody ? `*${safeTitle}*\n${safeBody}` : safeTitle,
            }),
          },
          5000,
        );
      } catch {
        // Non-fatal: in-app notification already succeeded.
      }
    }
    const pushGateway = process.env.PUSH_GATEWAY_URL?.trim();
    if (pushGateway && effects.pushDevices.length > 0) {
      for (const device of effects.pushDevices) {
        try {
          await sendOutboundRequest(
            pushGateway,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                token: device.token,
                platform: device.platform,
                title: effects.title,
                body: effects.body ?? "",
                type: effects.type,
              }),
            },
            { publicDestination: true, timeoutMs: 5000 },
          );
        } catch {
          // Non-fatal push error.
        }
      }
    }
  }
}
