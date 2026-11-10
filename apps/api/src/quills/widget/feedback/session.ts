import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import { mintWidgetSession, widgetEnabled } from "../../framework/audience";
import { defineQuillsRoute } from "../../framework/define-route";

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
    "Needs the widget on and a widget secret. Each call creates a new anonymous person; identify does not merge it into the identified person yet.",
  action: "create",
  rateLimit: { limit: 10, windowSeconds: 3600 },
  response: z.object({ sessionToken: z.string(), principalId: z.string() }),
  responseDescription: "The anonymous widget session",
  errors: { 404: "Widget off or without a secret" },
  allowKeys: ["sessionToken"],
  event: (_input, result) => ({
    type: "user.created",
    entityType: "principal",
    entityId: result.principalId,
    payload: { type: "anonymous" },
  }),
  handler: async ({ db }) => {
    const [config] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings)
      .limit(1);
    if (!config?.widgetSecret || !widgetEnabled(config.widgetConfig))
      throw new HTTPException(404, { message: "Workspace not found" });
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
      config.widgetSecret,
    );
    return { sessionToken: session.token, principalId: person!.id };
  },
});

export default apiRouter().openapi(...anonymousSession);
