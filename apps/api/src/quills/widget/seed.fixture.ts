import { createHash, createHmac } from "node:crypto";
import { settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import type { ContractEnv } from "../framework/contract";

/** Turns the widget on in a workspace with a fresh signing secret, and returns the secret. */
export async function enableWidget(env: ContractEnv, workspaceId: string) {
  const secret = `wgt_${env.id("secret")}`;
  await env.scoped(workspaceId, (db) =>
    db.update(settings).set({
      widgetConfig: JSON.stringify({ enabled: true }),
      widgetSecret: secret,
    }),
  );
  return secret;
}

/** A pairing code stored the way mintQuillsWidgetInstallCode stores it. */
export async function pairingCode(env: ContractEnv, workspaceId: string) {
  const code = `qbi_${env.id("code")}`;
  await env.scoped(workspaceId, (db) =>
    db.insert(kvStore).values({
      workspaceKey: "_",
      key: `widget:install-pairing:${createHash("sha256").update(code).digest("hex")}`,
      value: { remaining: 2 },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    }),
  );
  return code;
}

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An HS256 JWT, signed the way a host app's backend signs an identify token. */
export function signIdentity(
  claims: Record<string, unknown>,
  secret: string,
  alg = "HS256",
) {
  const unsigned = `${encode({ alg, typ: "JWT" })}.${encode(claims)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}
