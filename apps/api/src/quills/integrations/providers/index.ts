// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { ProviderCallError } from "../../framework/integration-config";
import type { OAuthProvider } from "../oauth-providers";
import { discord } from "./discord";
import { github } from "./github";
import { gitlab } from "./gitlab";
import { slack } from "./slack";

// The OAuth providers, one file each. Add a provider with its file and one line here. Its catalog
// entry, its connect route (oauth.ts) and its token refresh follow from this registry.
export const oauthProviders = {
  github,
  gitlab,
  slack,
  discord,
} satisfies Record<string, OAuthProvider>;
export type OAuthProviderType = keyof typeof oauthProviders;
export const oauthProvider = (type: string): OAuthProvider | undefined =>
  (oauthProviders as Record<string, OAuthProvider>)[type];
export const oauthTypes = Object.keys(oauthProviders) as [
  OAuthProviderType,
  ...OAuthProviderType[],
];

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
