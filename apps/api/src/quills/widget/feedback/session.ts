import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import { enforceWidgetAntiSpam } from "../../framework/anti-spam";
import { mintWidgetSession, widgetEnabled } from "../../framework/audience";
import { defineQuillsRoute } from "../../framework/define-route";
import { newSecret } from "../../settings/widget";

// An anonymous widget visitor (packages/widget RFC 0001): an unguessable server-issued session
// for a new anonymous principal. The session is an identity for reading and an author for
// writes; anonymous writes still need the portal's allowAnonymous switch. It is a public route
// because no credential exists yet. The session ends like an identified one.

const anonymousSession = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/widget/anonymous-session",
  operationId: "createQuillsWidgetAnonymousSession",
  summary: "Start an anonymous widget session",
  description:
    "Needs the widget on; creates the widget secret when it is missing. Each call creates a new anonymous person. Identify with this token as previousToken (and as the Bearer token) moves its activity to the identified person.",
  action: "create",
  rateLimit: { limit: 500, windowSeconds: 3600 },
  response: z.object({ sessionToken: z.string(), principalId: z.string() }),
  responseDescription: "The anonymous widget session",
  errors: {
    403: "Anti-spam challenge required or failed, or origin/sender blocked",
    404: "Widget off",
  },
  allowKeys: ["sessionToken"],
  event: (_input, result) => ({
    type: "user.created",
    entityType: "principal",
    entityId: result.principalId,
    payload: { type: "anonymous" },
  }),
  handler: async ({ db, workspaceId, request }) => {
    const [config] = await db
      .select({
        id: settings.id,
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings)
      .limit(1);
    if (!config || !widgetEnabled(config.widgetConfig))
      throw new HTTPException(404, { message: "Workspace not found" });
    await enforceWidgetAntiSpam(db, {
      workspaceId,
      widgetConfig: config.widgetConfig,
      kind: "session",
      ip: request.ip,
      challenge: request.challenge,
    });
    // A widget turned on before enabling created the secret has none: create it once. coalesce keeps
    // the secret of a concurrent request, so both sessions bind to the same one.
    const secret =
      config.widgetSecret ??
      (
        await db
          .update(settings)
          .set({
            widgetSecret: sql`coalesce(${settings.widgetSecret}, ${newSecret()})`,
          })
          .where(eq(settings.id, config.id))
          .returning({ secret: settings.widgetSecret })
      )[0]!.secret!;
    const [identity] = await db
      .insert(customer)
      .values({ name: "Anonymous", isAnonymous: true })
      .returning({ id: customer.id });
    const [person] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        role: "user",
        type: "anonymous",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const session = await mintWidgetSession(
      db,
      { principalId: person!.id, customerId: identity!.id },
      secret,
    );
    return { sessionToken: session.token, principalId: person!.id };
  },
});

export default apiRouter().openapi(...anonymousSession);
