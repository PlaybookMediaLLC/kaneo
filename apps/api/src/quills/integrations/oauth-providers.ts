// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { HTTPException } from "hono/http-exception";
import { ProviderCallError } from "../framework/integration-config";
import type { Provider } from "./catalog";

// The types and shared helpers of the OAuth providers. Each provider is one file in providers/, and
// providers/index.ts collects them. Each one has a fixed host, so a call never reaches an address
// from user input. Platform credentials (the OAuth app) belong to the workspace; the redirect URI is
// this instance's signed callback.

export type Destination = { id: string; name: string };
export type ExternalItem = {
  externalId: string;
  title: string;
  url: string | null;
  state: string;
};
export type Exchanged = {
  /** Sealed into integrations.secrets. Never returned. */
  secrets: Record<string, string>;
  workspaceName: string;
  account: string | null;
  /** Non-secret provider IDs, for example the Discord server. */
  config?: Record<string, string>;
};
/** A CRM record for customer context. The route that returns it selects and bounds the fields. */
export type Contact = {
  name: string | null;
  company: string | null;
  /** The record in the provider's own tool. */
  url: string | null;
  fields: { label: string; value: string }[];
};
/** Connects through the OAuth redirect: a connect route and the signed callback (oauth.ts). */
export type OAuthConnect = {
  authorizeUrl: (
    creds: Record<string, string>,
    redirectUri: string,
    state: string,
  ) => string;
  exchange: (
    code: string,
    redirectUri: string,
    creds: Record<string, string>,
  ) => Promise<Exchanged>;
  connectWithKey?: never;
};
/**
 * Connects with a key that a teammate enters, not through OAuth (Azure DevOps: a personal access
 * token). `fields` holds the other values that the connect route validated, for example the
 * organization. It checks the key with one provider call. The route seals `secrets` and calls
 * connect (connect.ts). Such a provider has no OAuth connect route and no callback.
 */
type KeyConnect = {
  connectWithKey: (
    key: string,
    fields: Record<string, string>,
  ) => Promise<Exchanged>;
  authorizeUrl?: never;
  exchange?: never;
};
/** A provider's catalog entry (catalog.ts), how it connects and its API calls. */
export type OAuthProvider = Provider & {
  /** Platform credential fields. `clientSecret` and `botToken` are secret. */
  credentials: readonly string[];
  /** Targets for channels: repositories, projects or chat channels. */
  destinations: (
    secrets: Record<string, string>,
    config: Record<string, unknown>,
    creds: Record<string, string>,
  ) => Promise<Destination[]>;
  /** Issue search in one target. Absent for chat providers. */
  search?: (
    secrets: Record<string, string>,
    target: string,
    query: string,
  ) => Promise<ExternalItem[]>;
  /** The statuses an inbound webhook reports, for status mappings. Empty: no status sync. */
  statuses: readonly string[];
  /** True when a channel ID is safe in a provider URL path. Absent: 1 to 30 letters and digits. */
  target?: (target: string) => boolean;
  /**
   * Gets new token fields for a due access token (freshSecrets in providers/index.ts calls it).
   * Absent when the provider's tokens do not expire.
   */
  refresh?: (
    secrets: Record<string, string>,
    creds: Record<string, string>,
  ) => Promise<Record<string, string>>;
  /** CRM lookup by email (HubSpot, Intercom, Zendesk). Null when no record matches. */
  contact?: (
    secrets: Record<string, string>,
    config: Record<string, unknown>,
    email: string,
  ) => Promise<Contact | null>;
} & (OAuthConnect | KeyConnect);

export const text = (value: unknown) =>
  typeof value === "string" ? value : "";
export const list = (value: unknown) => (Array.isArray(value) ? value : []);
export const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
export const form = (values: Record<string, string>) =>
  new URLSearchParams(values).toString();
export const formHeaders = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "application/json",
};
export const rejected = () =>
  new HTTPException(400, { message: "The provider rejected the request." });

/** GitHub `owner/repo` as a channel ID: `owner:repo` (a path segment cannot hold a slash). */
export const githubRepo = (target: string) => target.replace(":", "/");

/** Search words without provider qualifiers (`repo:x`, `-is:y`): the target alone decides the scope. */
export const plainQuery = (query: string) =>
  query
    .split(/\s+/)
    .filter((word) => word && !word.includes(":"))
    .join(" ")
    .slice(0, 200);

/** The token fields a refresh changes. A writer merges only these into the stored secrets. */
export const tokenFields = (secrets: Record<string, string>) => ({
  accessToken: secrets.accessToken ?? "",
  refreshToken: secrets.refreshToken ?? "",
  expiresAt: secrets.expiresAt ?? "",
});

/** The provider's error as an HTTP answer. Provider text never reaches the caller. Other errors throw. */
export function failureOf(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error;
  if (error instanceof ProviderCallError)
    return error.status === 401
      ? new HTTPException(409, {
          message: "The provider rejected the saved credentials. Reconnect.",
        })
      : error.status === 403
        ? new HTTPException(409, {
            message: "The connected account may not do this in the provider.",
          })
        : error.status && error.status < 500
          ? rejected()
          : new HTTPException(502, {
              message: "The provider could not be reached. Try again.",
            });
  throw error;
}
export function providerFailure(error: unknown): never {
  throw failureOf(error);
}

/**
 * This instance's public URL for a signed route. KANEO_API_URL is the API origin (host-native) or
 * `<client>/api` (bundled); the API router always serves under /api, as Better Auth assumes.
 */
export function signedUrl(path: string) {
  const origin = new URL(process.env.KANEO_API_URL || "http://localhost:1337")
    .origin;
  return `${origin}/api/quills-public/signed${path}`;
}
/** The OAuth redirect URI to register in the provider app: the signed callback route. */
export const redirectUri = (type: string) =>
  signedUrl(`/oauth/${type}/callback`);
