// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { ProviderCallError } from "../../framework/integration-config";
import type { OAuthConnect, OAuthProvider } from "../oauth-providers";
import { azureDevops } from "./azure-devops";
import { discord } from "./discord";
import { github } from "./github";
import { gitlab } from "./gitlab";
import { jira } from "./jira";
import { linear } from "./linear";
import { slack } from "./slack";

// The OAuth and key providers, one file each. To add a provider, add its file, its import above and
// one entry below. The key is the integration type. The catalog entry, the connect route (oauth.ts)
// and the token refresh in routes follow from this registry. Deliveries do not: the worker
// (jobs/handlers/integration-send.ts) sends only for the providers it names. Until it sends for a
// new provider, keep that provider's `events` empty. Declare each provider with `satisfies
// OAuthProvider`, not a type annotation: an annotated OAuth provider drops out of OAuthProviderType.
export const oauthProviders = {
  github,
  gitlab,
  slack,
  discord,
  jira,
  linear,
  azure_devops: azureDevops,
} satisfies Record<string, OAuthProvider>;
type Registry = typeof oauthProviders;
export const oauthProvider = (type: string): OAuthProvider | undefined =>
  (oauthProviders as Record<string, OAuthProvider>)[type];

/** The providers that connect through the OAuth redirect. A key provider has no connect route or callback. */
export type OAuthProviderType = {
  [K in keyof Registry]: Registry[K] extends OAuthConnect ? K : never;
}[keyof Registry];
export const oauthTypes = (
  Object.keys(oauthProviders) as (keyof Registry)[]
).filter((type) => typeof oauthProvider(type)?.authorizeUrl === "function") as [
  OAuthProviderType,
  ...OAuthProviderType[],
];
/** A provider of `oauthTypes`, with its OAuth calls. */
export const oauthApp = (
  type: OAuthProviderType,
): OAuthProvider & OAuthConnect => oauthProviders[type];

/** A channel ID that is safe in a provider URL path. Without a provider rule: 1 to 30 letters and digits. */
export const validTarget = (type: string, target: string) =>
  oauthProvider(type)?.target?.(target) ?? /^[A-Za-z0-9]{1,30}$/.test(target);

/**
 * A provider with `refresh` has expiring access tokens: one that is due within a minute is refreshed
 * first (GitLab's expire after two hours). `refreshed` holds the new secrets for the caller to store
 * in a new scoped transaction. A refresh is never retried: GitLab rotates the refresh token, so an
 * unanswered refresh leaves the connection to reconnect.
 */
// ponytail: two concurrent refreshes race on the rotated refresh token; the loser asks for a reconnect.
export async function freshSecrets(
  type: string,
  secrets: Record<string, string>,
  creds: Record<string, string>,
): Promise<{
  secrets: Record<string, string>;
  refreshed: Record<string, string> | null;
}> {
  const refresh = oauthProvider(type)?.refresh;
  const due = Date.parse(secrets.expiresAt ?? "");
  if (!refresh || !Number.isFinite(due) || due > Date.now() + 60_000)
    return { secrets, refreshed: null };
  if (!secrets.refreshToken) throw new ProviderCallError(401);
  const next = { ...secrets, ...(await refresh(secrets, creds)) };
  return { secrets: next, refreshed: next };
}
