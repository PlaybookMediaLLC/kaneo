import { conversations } from "../../database/quills/schema/conversation";
import { fixture } from "../framework/contract";
import { mintWidgetResumeToken } from "../framework/signed";
import { enableWidget } from "./seed.fixture";

export const getQuillsWidgetSession = fixture({
  seed: (env) => env.widgetVisitor(env.a),
  valid: (ids) => ({ bearer: ids.token }),
});

export const linkQuillsWidgetDevice = fixture({
  seed: async (env) => ({
    ...(await env.widgetVisitor(env.a)),
    device: env.id("device"),
  }),
  valid: (ids) => ({ bearer: ids.token, body: { device: ids.device } }),
});

export const heartbeatQuillsWidgetPresence = fixture({
  seed: (env) => env.widgetVisitor(env.a),
  valid: (ids) => ({ bearer: ids.token, body: { streamKey: "tab-1" } }),
});

export const resumeQuillsWidgetConversation = fixture({
  seed: async (env) => {
    const secret = await enableWidget(env, env.a);
    const visitor = await env.widgetVisitor(env.a);
    const [conv] = await env.scoped(env.a, (db) =>
      db
        .insert(conversations)
        .values({
          visitorPrincipalId: visitor.principalId as never,
          channel: "messenger",
          source: "widget",
          status: "open",
        })
        .returning({ id: conversations.id }),
    );
    return {
      secret,
      resumeToken: mintWidgetResumeToken(
        env.a,
        conv!.id,
        visitor.principalId,
        secret,
      ),
    };
  },
  valid: (ids) => ({ body: { resumeToken: ids.resumeToken } }),
  hidden: (ids) => [ids.secret],
});
