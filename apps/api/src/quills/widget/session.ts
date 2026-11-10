import { and, eq, isNull, sql } from "drizzle-orm";
import { apiRouter, z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import {
  pageViews,
  visitorDevices,
} from "../../database/quills/schema/visitor-analytics";
import { defineQuillsRoute } from "../framework/define-route";

// The widget session itself and the visitor device it runs on. Both act on the session's own
// principal only.

const getSession = defineQuillsRoute({
  audience: "widget",
  method: "get",
  path: "/widget/session",
  operationId: "getQuillsWidgetSession",
  summary: "Validate the widget session",
  description:
    "user is null for an anonymous visitor. The session expires 7 days after identify.",
  action: "read",
  response: z.object({
    user: z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      })
      .nullable(),
    canPortalHandoff: z.boolean(),
  }),
  responseDescription: "The session's visitor",
  handler: async ({ db, caller }) => {
    const [row] = await db
      .select({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        image: customer.image,
        type: principal.type,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, caller.principalId!))
      .limit(1);
    return {
      user:
        row && row.type !== "anonymous"
          ? {
              id: row.id,
              name: row.name,
              email: row.email,
              avatarUrl: row.image,
            }
          : null,
      canPortalHandoff: false,
    };
  },
});

const linkDevice = defineQuillsRoute({
  audience: "widget",
  method: "post",
  path: "/widget/device",
  operationId: "linkQuillsWidgetDevice",
  summary: "Link the visitor's device to the widget session",
  description:
    "device is the untrusted device ID from host-page storage, scoped to this workspace. Earlier unclaimed page views of the device move to the session's visitor.",
  action: "update",
  // Not named deviceId: it is a caller-chosen value, not a reference to an existing record.
  body: z.object({ device: z.string().min(1).max(128) }),
  response: z.object({ linked: z.boolean() }),
  responseDescription: "The device is linked",
  event: {
    none: "Visitor analytics only; no customer or feedback record changes",
  },
  handler: async ({ db, caller, body }) => {
    const principalId = caller.principalId!;
    await db
      .insert(visitorDevices)
      .values({ deviceId: body.device, principalId })
      .onConflictDoUpdate({
        target: [visitorDevices.workspaceId, visitorDevices.deviceId],
        set: { principalId, lastSeenAt: sql`now()` },
      });
    await db
      .update(pageViews)
      .set({ principalId })
      .where(
        and(eq(pageViews.deviceId, body.device), isNull(pageViews.principalId)),
      );
    return { linked: true };
  },
});

export default apiRouter()
  .openapi(...getSession)
  .openapi(...linkDevice);
