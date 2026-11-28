import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { instanceProviderConfigTable } from "../../database/schema";

export type SmtpProviderSettings = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  from: string;
};

export type OidcProviderSettings = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  groupsClaim: string;
  lockProfileFields: boolean;
};

function deriveSealKey(): Buffer {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "kaneo-dev-fallback-secret-change-me";
  return createHash("sha256")
    .update(`kaneo:instance_provider_config:v1:${secret}`)
    .digest();
}

export function sealProviderPayload(payload: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSealKey(), iv);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function unsealProviderPayload<T>(sealed: string): T {
  const [ivB64, tagB64, dataB64] = sealed.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted provider payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveSealKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function isSmtpLockedByEnv(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

export function isOidcLockedByEnv(): boolean {
  return Boolean(
    process.env.CUSTOM_OAUTH_CLIENT_ID?.trim() ||
    process.env.OIDC_CLIENT_ID?.trim(),
  );
}

export async function getSmtpProviderConfigView() {
  const lockedByEnv = isSmtpLockedByEnv();
  if (lockedByEnv) {
    return {
      configured: true,
      lockedByEnv: true,
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      username: process.env.SMTP_USER ?? "",
      hasPassword: Boolean(process.env.SMTP_PASSWORD),
      from: process.env.SMTP_FROM ?? "",
    };
  }

  const [row] = await db
    .select()
    .from(instanceProviderConfigTable)
    .where(eq(instanceProviderConfigTable.providerKey, "smtp"))
    .limit(1);

  if (!row) {
    return {
      configured: false,
      lockedByEnv: false,
      host: "",
      port: 587,
      secure: false,
      username: "",
      hasPassword: false,
      from: "",
    };
  }

  const stored = unsealProviderPayload<SmtpProviderSettings>(
    row.encryptedPayload,
  );
  return {
    configured: Boolean(stored.host),
    lockedByEnv: false,
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    username: stored.username,
    hasPassword: Boolean(stored.password),
    from: stored.from,
  };
}

export async function saveSmtpProviderConfig(
  input: SmtpProviderSettings,
  actorUserId: string,
) {
  if (isSmtpLockedByEnv()) {
    throw new HTTPException(409, {
      message: "SMTP configuration is locked by environment variables",
    });
  }

  let password = input.password;
  if (password === undefined) {
    const [existing] = await db
      .select()
      .from(instanceProviderConfigTable)
      .where(eq(instanceProviderConfigTable.providerKey, "smtp"))
      .limit(1);
    if (existing) {
      const prev = unsealProviderPayload<SmtpProviderSettings>(
        existing.encryptedPayload,
      );
      password = prev.password;
    }
  }

  const sealed = sealProviderPayload({
    host: input.host,
    port: input.port,
    secure: input.secure,
    username: input.username,
    ...(password ? { password } : {}),
    from: input.from,
  });

  await db
    .insert(instanceProviderConfigTable)
    .values({
      providerKey: "smtp",
      encryptedPayload: sealed,
      updatedByUserId: actorUserId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: instanceProviderConfigTable.providerKey,
      set: {
        encryptedPayload: sealed,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      },
    });

  return getSmtpProviderConfigView();
}

export async function getOidcProviderConfigView() {
  const lockedByEnv = isOidcLockedByEnv();
  if (lockedByEnv) {
    return {
      configured: true,
      lockedByEnv: true,
      issuer:
        process.env.CUSTOM_OAUTH_DISCOVERY_URL || process.env.OIDC_ISSUER || "",
      clientId:
        process.env.CUSTOM_OAUTH_CLIENT_ID || process.env.OIDC_CLIENT_ID || "",
      hasClientSecret: Boolean(
        process.env.CUSTOM_OAUTH_CLIENT_SECRET ||
        process.env.OIDC_CLIENT_SECRET,
      ),
      scopes: process.env.CUSTOM_OAUTH_SCOPES || "openid email profile groups",
      groupsClaim: process.env.OIDC_GROUPS_CLAIM || "groups",
      lockProfileFields: Boolean(process.env.CUSTOM_OAUTH_MANAGED_FIELDS),
    };
  }

  const [row] = await db
    .select()
    .from(instanceProviderConfigTable)
    .where(eq(instanceProviderConfigTable.providerKey, "oidc"))
    .limit(1);

  if (!row) {
    return {
      configured: false,
      lockedByEnv: false,
      issuer: "",
      clientId: "",
      hasClientSecret: false,
      scopes: "openid email profile groups",
      groupsClaim: "groups",
      lockProfileFields: false,
    };
  }

  const stored = unsealProviderPayload<OidcProviderSettings>(
    row.encryptedPayload,
  );
  return {
    configured: Boolean(stored.issuer && stored.clientId),
    lockedByEnv: false,
    issuer: stored.issuer,
    clientId: stored.clientId,
    hasClientSecret: Boolean(stored.clientSecret),
    scopes: stored.scopes,
    groupsClaim: stored.groupsClaim,
    lockProfileFields: stored.lockProfileFields,
  };
}

export async function saveOidcProviderConfig(
  input: OidcProviderSettings,
  actorUserId: string,
) {
  if (isOidcLockedByEnv()) {
    throw new HTTPException(409, {
      message: "OIDC configuration is locked by environment variables",
    });
  }

  let clientSecret = input.clientSecret;
  if (clientSecret === undefined) {
    const [existing] = await db
      .select()
      .from(instanceProviderConfigTable)
      .where(eq(instanceProviderConfigTable.providerKey, "oidc"))
      .limit(1);
    if (existing) {
      const prev = unsealProviderPayload<OidcProviderSettings>(
        existing.encryptedPayload,
      );
      clientSecret = prev.clientSecret;
    }
  }

  const sealed = sealProviderPayload({
    issuer: input.issuer,
    clientId: input.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: input.scopes,
    groupsClaim: input.groupsClaim,
    lockProfileFields: input.lockProfileFields,
  });

  await db
    .insert(instanceProviderConfigTable)
    .values({
      providerKey: "oidc",
      encryptedPayload: sealed,
      updatedByUserId: actorUserId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: instanceProviderConfigTable.providerKey,
      set: {
        encryptedPayload: sealed,
        updatedByUserId: actorUserId,
        updatedAt: new Date(),
      },
    });

  return getOidcProviderConfigView();
}
