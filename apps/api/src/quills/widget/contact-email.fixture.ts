import { eq } from "drizzle-orm";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { mintWidgetSession, widgetEnabled } from "../framework/audience";
import { fixture, type ContractEnv } from "../framework/contract";
import { contactEmailCode } from "../framework/signed";

/** A new anonymous widget visitor and its session, keeping a widget secret that a fixture set. */
export function anonymousVisitor(
  env: ContractEnv,
  workspaceId: string,
  contactEmail: string | null = null,
) {
  return env.scoped(workspaceId, async (db) => {
    const [config] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings);
    const secret = config?.widgetSecret ?? `wgt_${env.id("anon")}`;
    if (!config?.widgetSecret || !widgetEnabled(config.widgetConfig))
      await db.update(settings).set({
        widgetConfig: JSON.stringify({ enabled: true }),
        widgetSecret: secret,
      });
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
        contactEmail,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const owner = { principalId: person!.id, customerId: identity!.id };
    const { token } = await mintWidgetSession(db, owner, secret);
    return { token, secret, ...owner };
  });
}

/** A pending change to `email` for the visitor, and its code. */
async function pendingChange(env: ContractEnv) {
  const visitor = await anonymousVisitor(env, env.a);
  const email = `${env.id("new").toLowerCase()}@example.test`;
  const nonce = env.id("nonce");
  await env.scoped(env.a, (db) =>
    db.insert(kvStore).values({
      workspaceKey: "_",
      key: `contact-email:change:${visitor.principalId}`,
      value: { email, nonce, tries: 0 },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }),
  );
  const code = contactEmailCode(visitor.secret, {
    principalId: visitor.principalId,
    purpose: "change",
    email,
    nonce,
  });
  return { ...visitor, email, code };
}

export const getQuillsEmailChangeState = fixture({
  seed: (env) => anonymousVisitor(env, env.a, "old@example.test"),
  valid: (ids) => ({ bearer: ids.token }),
});
export const sendQuillsCurrentAddressCode = fixture({
  seed: (env) => anonymousVisitor(env, env.a, "old@example.test"),
  valid: (ids) => ({ bearer: ids.token }),
});
export const requestQuillsEmailChange = fixture({
  seed: (env) => anonymousVisitor(env, env.a),
  valid: (ids) => ({
    bearer: ids.token,
    body: { email: "new-address@example.test" },
  }),
});
export const confirmQuillsEmailChange = fixture({
  seed: pendingChange,
  valid: (ids) => ({
    bearer: ids.token,
    body: { email: ids.email, code: ids.code },
  }),
  hidden: (ids) => [ids.code, ids.secret],
});

/** The visitor's stored contact address, for feature tests. */
export const contactEmailOf = (env: ContractEnv, principalId: string) =>
  env.scoped(
    env.a,
    async (db) =>
      (
        await db
          .select({ email: principal.contactEmail })
          .from(principal)
          .where(eq(principal.id, principalId as never))
      )[0]?.email ?? null,
  );
