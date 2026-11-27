import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { settings } from "../../database/quills/schema/auth";
import { customDomains } from "../../database/quills/schema/custom-domains";
import {
  inAppNotifications,
  notificationPreferences,
} from "../../database/quills/schema/notifications";
import { pushDevices } from "../../database/quills/schema/push-devices";
import {
  webhookDeliveries,
  webhooks,
} from "../../database/quills/schema/webhooks";
import * as kaneo from "../../database/schema";
import {
  clearWidgetHostCache,
  customWidgetHostMiddleware,
} from "../../utils/custom-widget-host";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { sendTeammateDigests } from "../jobs/handlers/sweeps";
import { wants } from "../jobs/preferences";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

async function send(
  method: string,
  path: string,
  options: { user?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (options.user) headers["x-test-user"] = options.user;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
}

describe.skipIf(!url)(
  "Wave 4: custom widget domain (#318), quiet notifications (#321), reliable webhooks (#330), multi-brand email (#332)",
  () => {
    let wsA: string;
    let ownerUserId: string;
    let ownerPrincipalId: string;

    beforeAll(async () => {
      vi.stubEnv(
        "NOTIFICATION_SECRET_ENCRYPTION_KEY",
        "wave4-test-enc-key-0123456789abcdef",
      );
      pool = new Pool({ connectionString: url });
      const world = await startContract(pool, url!);
      const env = contractEnv(world);
      wsA = env.a;
      ownerUserId = env.owner;

      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db
          .update(settings)
          .set({ widgetConfig: { enabled: true, messengerEnabled: true } })
          .where(eq(settings.workspaceId, wsA));
      });

      // Trigger owner principal provisioning via a harmless GET
      const meRes = await send("GET", `/quills/${wsA}/settings`, {
        user: ownerUserId,
      });
      expect(meRes.status).toBe(200);
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const { principal } = await import("../../database/quills/schema/auth");
        const [p] = await db
          .select({ id: principal.id })
          .from(principal)
          .where(eq(principal.kaneoUserId, ownerUserId))
          .limit(1);
        ownerPrincipalId = p!.id;
      });
    }, 30_000);

    afterAll(async () => {
      clearWidgetHostCache();
      vi.unstubAllEnvs();
      await stopContract(pool);
    });

    it("#318 resolves verified custom widget domain with zero cookies and CORS", async () => {
      const host = `widget-${Date.now()}.example.com`;
      // Insert verified custom widget domain directly (bypasses cloud entitlement check in tests)
      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db
          .insert(customDomains)
          .values({
            kind: "widget",
            domain: host,
            verificationValue: "verify123",
            verifiedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [customDomains.workspaceId, customDomains.kind],
            set: { domain: host, verifiedAt: new Date() },
          });
      });

      clearWidgetHostCache();
      const lookup = await pool.query<{ ws: string | null }>(
        "SELECT quills.custom_domain_workspace($1, 'widget') AS ws",
        [host],
      );
      expect(lookup.rows[0]?.ws).toBe(wsA);

      // Wrap a mini Hono host with customWidgetHostMiddleware forwarding to publicRouter
      const hostApp = new Hono();
      hostApp.use(
        "*",
        customWidgetHostMiddleware((req) => {
          const rewritten = new URL(req.url);
          rewritten.pathname = rewritten.pathname.replace(/^\/api/, "");
          return app.request(rewritten.toString(), {
            method: req.method,
            headers: req.headers,
          });
        }),
      );
      const res = await hostApp.request(`https://${host}/widget/config.json`, {
        headers: { host, cookie: "session=should-be-stripped" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("#321 enforces quiet defaults, workspace defaults, personal override precedence, encrypted push token, and digests", async () => {
      // Quiet defaults before any settings saved: mention ON, ticket_watch email OFF
      await withQuillsSystemWorkspace(wsA, async (db) => {
        expect(
          await wants(db, ownerPrincipalId as never, "note_mention", "email"),
        ).toBe(true);
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "email"),
        ).toBe(false);
        expect(
          await wants(
            db,
            ownerPrincipalId as never,
            "conversation_routed_team",
            "slackDm",
          ),
        ).toBe(false);
      });

      // Set workspace default turning ticket_watch email ON
      const wsDefRes = await send(
        "PUT",
        `/quills/${wsA}/settings/notification-defaults`,
        {
          user: ownerUserId,
          body: {
            digestFrequency: "daily",
            matrix: [
              {
                type: "ticket_watch",
                inApp: true,
                email: true,
                push: false,
                slackDm: true,
              },
            ],
          },
        },
      );
      expect(wsDefRes.status).toBe(200);

      // Workspace default now applies
      await withQuillsSystemWorkspace(wsA, async (db) => {
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "email"),
        ).toBe(true);
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "slackDm"),
        ).toBe(true);
      });

      // Personal preference overrides workspace default (personal ALWAYS wins!)
      const prefRes = await send(
        "PATCH",
        `/quills/${wsA}/notification-preferences`,
        {
          user: ownerUserId,
          body: {
            digestFrequency: "hourly",
            matrix: [
              {
                type: "ticket_watch",
                inApp: true,
                email: false,
                push: true,
                slackDm: false,
              },
            ],
          },
        },
      );
      expect(prefRes.status).toBe(200);
      const savedPref = await prefRes.json();
      expect(savedPref.digestFrequency).toBe("hourly");

      await withQuillsSystemWorkspace(wsA, async (db) => {
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "email"),
        ).toBe(false);
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "push"),
        ).toBe(true);
        expect(
          await wants(db, ownerPrincipalId as never, "ticket_watch", "slackDm"),
        ).toBe(false);
      });

      // Push device stores encrypted token alongside SHA-256 hash
      const devRes = await send("POST", `/quills/${wsA}/devices`, {
        user: ownerUserId,
        body: { token: "fcm-raw-device-token-xyz", platform: "ios" },
      });
      expect(devRes.status).toBe(200);
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [dev] = await db
          .select({
            token: pushDevices.token,
            tokenEncrypted: pushDevices.tokenEncrypted,
          })
          .from(pushDevices)
          .where(eq(pushDevices.principalId, ownerPrincipalId as never))
          .limit(1);
        expect(dev?.token).not.toBe("fcm-raw-device-token-xyz");
        expect(dev?.tokenEncrypted).toBeTruthy();
        expect(dev?.tokenEncrypted).not.toContain("fcm-raw-device-token-xyz");
      });

      // Seed unread notification, run teammate digest sweep, and verify digest mail builder renders cleanly
      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db.insert(inAppNotifications).values({
          principalId: ownerPrincipalId as never,
          type: "note_mention",
          title: "Mentioned in a note",
        });
        await sendTeammateDigests(db);
        const [pref] = await db
          .select({
            digestLastSentAt: notificationPreferences.digestLastSentAt,
          })
          .from(notificationPreferences)
          .where(
            eq(notificationPreferences.principalId, ownerPrincipalId as never),
          );
        expect(pref?.digestLastSentAt).not.toBeNull();

        const { supportSubscribers } =
          await import("../jobs/handlers/support-mail");
        const digestMail = await supportSubscribers[
          "notification.digest_sent"
        ]?.mail?.(
          db,
          {
            id: "evt_digest_test" as never,
            eventId: "evt_digest_test",
            workspaceId: wsA,
            type: "notification.digest_sent",
            entityType: "principal",
            entityId: ownerPrincipalId,
            actorPrincipalId: null,
            payload: { frequency: "hourly", unreadCount: "1" },
            createdAt: new Date(),
            publishedAt: null,
          } as never,
          ownerPrincipalId as never,
        );
        expect(digestMail?.emailType).toBe("TeammateDigestEmail");
      });
    });

    it("#330 lists webhook deliveries, replays single/failed attempts, and supports GET /events?since=", async () => {
      // Seed webhook + failed delivery row
      let webhookId!: string;
      let deliveryId!: string;
      await withQuillsSystemWorkspace(wsA, async (db) => {
        const [hook] = await db
          .insert(webhooks)
          .values({
            createdById: ownerPrincipalId as never,
            url: "https://203.0.113.55/hook",
            secret: "enc:dummy",
            events: ["post.created"],
          })
          .returning({ id: webhooks.id });
        webhookId = hook!.id;
        const [del] = await db
          .insert(webhookDeliveries)
          .values({
            webhookId: hook!.id,
            eventId: "evt_replay_test_1",
            eventType: "post.created",
            attempt: 1,
            status: "failed",
            httpStatus: 502,
            durationMs: 250,
            responseSnippet: "Bad Gateway",
            error: "HTTP 502",
          })
          .returning({ id: webhookDeliveries.id });
        deliveryId = del!.id;
      });

      // List deliveries
      const listRes = await send(
        "GET",
        `/quills/${wsA}/webhooks/${webhookId}/deliveries`,
        { user: ownerUserId },
      );
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.total).toBe(1);
      expect(listBody.deliveries[0].httpStatus).toBe(502);
      expect(listBody.deliveries[0].responseSnippet).toBe("Bad Gateway");

      // Replay single delivery
      const replayRes = await send(
        "POST",
        `/quills/${wsA}/webhooks/${webhookId}/deliveries/${deliveryId}/replay`,
        { user: ownerUserId },
      );
      expect(replayRes.status).toBe(200);
      const replayBody = await replayRes.json();
      expect(replayBody.queued).toBe(true);
      expect(replayBody.jobId).toBeTruthy();

      // Replay all failed
      const replayFailedRes = await send(
        "POST",
        `/quills/${wsA}/webhooks/${webhookId}/deliveries/replay-failed`,
        { user: ownerUserId },
      );
      expect(replayFailedRes.status).toBe(200);
      expect((await replayFailedRes.json()).queuedCount).toBe(1);

      // Outbox replay GET /events?since=
      const since = new Date(Date.now() - 3600_000).toISOString();
      const eventsRes = await send(
        "GET",
        `/quills/${wsA}/events?since=${encodeURIComponent(since)}&limit=10`,
        { user: ownerUserId },
      );
      expect(eventsRes.status).toBe(200);
      const eventsBody = await eventsRes.json();
      expect(Array.isArray(eventsBody.events)).toBe(true);
      expect(eventsBody.events.length).toBeGreaterThanOrEqual(1);
      expect(eventsBody.events[0].cursor).toBeTruthy();
    });

    it("#332 creates two distinct brands, renders identical preview vs send-test HTML, and enforces 10/hr send-test cap", async () => {
      const b1Res = await send("POST", `/quills/${wsA}/settings/brands`, {
        user: ownerUserId,
        body: {
          name: "Acme Support",
          slug: "acme-support",
          primaryColor: "#2563eb",
          footerText: "Acme Corp",
          hidePoweredBy: true,
        },
      });
      expect(b1Res.status).toBe(200);
      const brand1 = (await b1Res.json()).brand;

      const b2Res = await send("POST", `/quills/${wsA}/settings/brands`, {
        user: ownerUserId,
        body: {
          name: "Beta Labs",
          slug: "beta-labs",
          primaryColor: "#e11d48",
          footerText: "Beta Labs Inc.",
        },
      });
      expect(b2Res.status).toBe(200);
      const brand2 = (await b2Res.json()).brand;

      const templatePayload = {
        locale: "en",
        subject: "Update on {{subject}}",
        mode: "blocks" as const,
        blocksJson: [
          { id: "h1", type: "header" as const, content: "Hi {{customerName}}" },
          {
            id: "t1",
            type: "text" as const,
            content: "Your ticket is updated.",
          },
          {
            id: "btn1",
            type: "button" as const,
            label: "Open request",
            url: "https://support.example.com/r/123",
          },
        ],
      };

      const upsertRes = await send(
        "PUT",
        `/quills/${wsA}/settings/brands/${brand1.id}/email-templates/conversation_reply`,
        { user: ownerUserId, body: templatePayload },
      );
      expect(upsertRes.status).toBe(200);

      const vars = { customerName: "Jordan", subject: "Login issue" };
      const preview1Res = await send(
        "POST",
        `/quills/${wsA}/settings/email-templates/preview`,
        {
          user: ownerUserId,
          body: {
            brandId: brand1.id,
            subject: templatePayload.subject,
            mode: templatePayload.mode,
            blocksJson: templatePayload.blocksJson,
            variables: vars,
          },
        },
      );
      expect(preview1Res.status).toBe(200);
      const preview1 = await preview1Res.json();

      const preview2Res = await send(
        "POST",
        `/quills/${wsA}/settings/email-templates/preview`,
        {
          user: ownerUserId,
          body: {
            brandId: brand2.id,
            subject: templatePayload.subject,
            mode: templatePayload.mode,
            blocksJson: templatePayload.blocksJson,
            variables: vars,
          },
        },
      );
      expect(preview2Res.status).toBe(200);
      const preview2 = await preview2Res.json();
      expect(preview1.html).not.toBe(preview2.html);
      expect(preview1.html).toContain("#2563eb");
      expect(preview2.html).toContain("#e11d48");

      // Send Test HTML must match Preview HTML byte-for-byte
      const sendTestRes = await send(
        "POST",
        `/quills/${wsA}/settings/email-templates/send-test`,
        {
          user: ownerUserId,
          body: {
            to: "tester@example.com",
            brandId: brand1.id,
            subject: templatePayload.subject,
            mode: templatePayload.mode,
            blocksJson: templatePayload.blocksJson,
            variables: vars,
          },
        },
      );
      expect(sendTestRes.status).toBe(200);
      const sentTest = await sendTestRes.json();
      expect(sentTest.html).toBe(preview1.html);
      expect(sentTest.subject).toBe(preview1.subject);

      // Push rate bucket to 10 and verify 11th call returns 429
      await withQuillsSystemWorkspace(wsA, async (db) => {
        await db.execute(
          sql`UPDATE quills.rate_bucket SET count = 10 WHERE key = 'email-template:send-test'`,
        );
      });
      const throttledRes = await send(
        "POST",
        `/quills/${wsA}/settings/email-templates/send-test`,
        {
          user: ownerUserId,
          body: {
            to: "tester@example.com",
            brandId: brand1.id,
            subject: templatePayload.subject,
            mode: templatePayload.mode,
            blocksJson: templatePayload.blocksJson,
            variables: vars,
          },
        },
      );
      expect(throttledRes.status).toBe(429);
    });
  },
);
