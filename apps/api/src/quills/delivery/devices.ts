import { and, eq } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { pushDevices } from "../../database/quills/schema/push-devices";
import { hashToken } from "../framework/audience";
import { defineQuillsRoute } from "../framework/define-route";

// The caller's mobile push devices (the source's /api/devices). The source accepts only a
// teammate's dashboard session, so these are teammate routes, not customer routes. The token
// column holds the SHA-256 hash of the APNs or FCM registration token, never the token.

const personal = { none: "The caller's own device; no shared record changes." };
const token = z.string().trim().min(1).max(4096);

const register = defineQuillsRoute({
  method: "post",
  path: "/devices",
  operationId: "registerQuillsPushDevice",
  summary: "Register the caller's push device",
  description:
    "A token that another principal registered moves to the caller: holding the token proves the device. Only its hash is stored, so no push sender can read it back yet.",
  action: "read",
  body: z.object({ token, platform: z.enum(["ios", "android"]) }),
  response: z.object({ registered: z.boolean() }),
  responseDescription: "The device is registered",
  event: personal,
  handler: async ({ db, actor, body }) => {
    const now = new Date();
    await db
      .insert(pushDevices)
      .values({
        principalId: actor.principalId,
        token: hashToken(body.token),
        platform: body.platform,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [pushDevices.workspaceId, pushDevices.token],
        set: {
          principalId: actor.principalId,
          platform: body.platform,
          lastSeenAt: now,
        },
      });
    return { registered: true };
  },
});

const unregister = defineQuillsRoute({
  method: "delete",
  path: "/devices",
  operationId: "unregisterQuillsPushDevice",
  summary: "Unregister the caller's push device",
  description: "Removes only the caller's own row for the token.",
  action: "read",
  body: z.object({ token }),
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a device was removed",
  event: personal,
  handler: async ({ db, actor, body }) => ({
    changed:
      (
        await db
          .delete(pushDevices)
          .where(
            and(
              eq(pushDevices.token, hashToken(body.token)),
              eq(pushDevices.principalId, actor.principalId),
            ),
          )
          .returning({ id: pushDevices.id })
      ).length > 0,
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...register)
  .openapi(...unregister);
