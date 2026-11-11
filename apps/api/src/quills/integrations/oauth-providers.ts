// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { HTTPException } from "hono/http-exception";
import {
  ProviderCallError,
  providerJson,
} from "../framework/integration-config";

// The OAuth providers whose task integrations Kaneo already has (decision D6). Each one has a fixed
// host, so a call never reaches an address from user input. Platform credentials (the OAuth app)
// belong to the workspace; the redirect URI is this instance's signed callback.

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
type OAuthProvider = {
  name: string;
  /** Platform credential fields. `clientSecret` and `botToken` are secret. */
  credentials: readonly string[];
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
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const form = (values: Record<string, string>) =>
  new URLSearchParams(values).toString();
const json = { "content-type": "application/json", accept: "application/json" };
const formHeaders = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "application/json",
};
const githubHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "Quills",
  "x-github-api-version": "2022-11-28",
});
const rejected = () =>
  new HTTPException(400, { message: "The provider rejected the request." });

/** GitHub `owner/repo` as a channel ID: `owner:repo` (a path segment cannot hold a slash). */
export const githubRepo = (target: string) => target.replace(":", "/");

/**
 * A repository or project target that is safe in a provider URL path: GitHub `owner:repo` without
 * `.` or `..` segments, a numeric GitLab project ID, a Slack or Discord channel ID.
 */
export function validTarget(type: string, target: string) {
  if (type === "github") {
    const parts = target.split(":");
    return (
      parts.length === 2 &&
      parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part)) &&
      parts.every((part) => part !== "." && part !== "..")
    );
  }
  if (type === "gitlab") return /^\d{1,20}$/.test(target);
  return /^[A-Za-z0-9]{1,30}$/.test(target);
}

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

export const oauthProviders = {
  github: {
    name: "GitHub",
    credentials: ["clientId", "clientSecret"],
    authorizeUrl: (creds, redirectUri, state) =>
      `https://github.com/login/oauth/authorize?${form({
        client_id: creds.clientId!,
        redirect_uri: redirectUri,
        state,
        scope: "repo",
      })}`,
    exchange: async (code, redirectUri, creds) => {
      const token = record(
        await providerJson("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        }),
      );
      // GitHub answers 200 with an error field for a rejected code.
      const accessToken = text(token.access_token);
      if (!accessToken) throw rejected();
      const user = record(
        await providerJson("https://api.github.com/user", {
          headers: githubHeaders(accessToken),
        }),
      );
      const login = text(user.login);
      return {
        secrets: { accessToken },
        workspaceName: text(user.name) || login || "GitHub",
        account: login || null,
      };
    },
    destinations: async (secrets) =>
      list(
        await providerJson(
          "https://api.github.com/user/repos?per_page=100&sort=updated",
          { headers: githubHeaders(secrets.accessToken ?? "") },
        ),
      )
        .map(record)
        .map((repo) => text(repo.full_name))
        .filter((name) => /^[\w.-]+\/[\w.-]+$/.test(name))
        .map((name) => ({ id: name.replace("/", ":"), name })),
    search: async (secrets, target, query) =>
      list(
        record(
          await providerJson(
            `https://api.github.com/search/issues?${form({
              q: `${plainQuery(query)} repo:${githubRepo(target)} is:issue`,
              per_page: "20",
            })}`,
            { headers: githubHeaders(secrets.accessToken ?? "") },
          ),
        ).items,
      )
        .map(record)
        .map((issue) => ({
          externalId: `${githubRepo(target)}#${String(issue.number)}`,
          title: text(issue.title),
          url: text(issue.html_url) || null,
          state: text(issue.state) === "closed" ? "Closed" : "Open",
        })),
    statuses: ["Open", "Closed"],
  },
  gitlab: {
    name: "GitLab",
    credentials: ["clientId", "clientSecret"],
    authorizeUrl: (creds, redirectUri, state) =>
      `https://gitlab.com/oauth/authorize?${form({
        client_id: creds.clientId!,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: "api",
      })}`,
    exchange: async (code, redirectUri, creds) => {
      const token = record(
        await providerJson("https://gitlab.com/oauth/token", {
          method: "POST",
          headers: formHeaders,
          body: form({
            client_id: creds.clientId ?? "",
            client_secret: creds.clientSecret ?? "",
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        }),
      );
      const accessToken = text(token.access_token);
      if (!accessToken) throw rejected();
      const user = record(
        await providerJson("https://gitlab.com/api/v4/user", {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      );
      const expiresIn = Number(token.expires_in);
      return {
        secrets: {
          accessToken,
          refreshToken: text(token.refresh_token),
          // Refreshed by the delivery job when it is due (jobs/handlers/integration-send.ts).
          expiresAt: Number.isFinite(expiresIn)
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : "",
        },
        workspaceName: text(user.name) || text(user.username) || "GitLab",
        account: text(user.username) || null,
      };
    },
    destinations: async (secrets) =>
      list(
        await providerJson(
          "https://gitlab.com/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true",
          { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
        ),
      )
        .map(record)
        .filter((project) => Number.isInteger(project.id))
        .map((project) => ({
          id: String(project.id),
          name: text(project.path_with_namespace),
        })),
    search: async (secrets, target, query) =>
      list(
        await providerJson(
          `https://gitlab.com/api/v4/projects/${encodeURIComponent(target)}/issues?${form({ search: plainQuery(query), per_page: "20" })}`,
          { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
        ),
      )
        .map(record)
        .map((issue) => ({
          externalId: `${target}#${String(issue.iid)}`,
          title: text(issue.title),
          url: text(issue.web_url) || null,
          state: text(issue.state),
        })),
    statuses: ["opened", "closed"],
  },
  slack: {
    name: "Slack",
    credentials: ["clientId", "clientSecret"],
    authorizeUrl: (creds, redirectUri, state) =>
      `https://slack.com/oauth/v2/authorize?${form({
        client_id: creds.clientId!,
        redirect_uri: redirectUri,
        state,
        scope: "chat:write,channels:read",
      })}`,
    exchange: async (code, redirectUri, creds) => {
      const token = record(
        await providerJson("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: formHeaders,
          body: form({
            client_id: creds.clientId ?? "",
            client_secret: creds.clientSecret ?? "",
            code,
            redirect_uri: redirectUri,
          }),
        }),
      );
      // Slack answers 200 with ok: false for a rejected code.
      const accessToken = text(token.access_token);
      if (token.ok !== true || !accessToken) throw rejected();
      const team = record(token.team);
      return {
        secrets: { accessToken },
        workspaceName: text(team.name) || "Slack",
        account: text(team.name) || null,
        config: { teamId: text(team.id) },
      };
    },
    destinations: async (secrets) => {
      const answer = record(
        await providerJson(
          "https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200",
          { headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` } },
        ),
      );
      if (answer.ok !== true) throw new ProviderCallError(401);
      return list(answer.channels)
        .map(record)
        .map((channel) => ({
          id: text(channel.id),
          name: `#${text(channel.name)}`,
        }));
    },
    statuses: [],
  },
  discord: {
    name: "Discord",
    // The bot token posts messages; the OAuth grant adds the bot to one server.
    credentials: ["clientId", "clientSecret", "botToken"],
    authorizeUrl: (creds, redirectUri, state) =>
      `https://discord.com/oauth2/authorize?${form({
        client_id: creds.clientId!,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: "bot",
        permissions: "3072",
      })}`,
    exchange: async (code, redirectUri, creds) => {
      const token = record(
        await providerJson("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: formHeaders,
          body: form({
            client_id: creds.clientId ?? "",
            client_secret: creds.clientSecret ?? "",
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        }),
      );
      const guild = record(token.guild);
      const guildId = text(guild.id);
      if (!/^\d{1,30}$/.test(guildId)) throw rejected();
      // The grant's user token is not kept: messages use the bot token.
      return {
        secrets: {},
        workspaceName: text(guild.name) || "Discord",
        account: text(guild.name) || null,
        config: { guildId },
      };
    },
    destinations: async (_secrets, config, creds) => {
      const guildId = text(config.guildId);
      if (!/^\d{1,30}$/.test(guildId)) return [];
      return list(
        await providerJson(
          `https://discord.com/api/v10/guilds/${guildId}/channels`,
          { headers: { authorization: `Bot ${creds.botToken ?? ""}` } },
        ),
      )
        .map(record)
        .filter((channel) => channel.type === 0)
        .map((channel) => ({
          id: text(channel.id),
          name: `#${text(channel.name)}`,
        }));
    },
    statuses: [],
  },
} satisfies Record<string, OAuthProvider>;
export type OAuthProviderType = keyof typeof oauthProviders;
export const oauthProvider = (type: string): OAuthProvider | undefined =>
  (oauthProviders as Record<string, OAuthProvider>)[type];
export const oauthTypes = Object.keys(oauthProviders) as [
  OAuthProviderType,
  ...OAuthProviderType[],
];

/**
 * GitLab access tokens expire after two hours: one that is due within a minute is refreshed first.
 * `refreshed` holds the new secrets for the caller to store in a new scoped transaction. Other
 * providers' tokens do not expire. A refresh is never retried: GitLab rotates the refresh token, so
 * an unanswered refresh leaves the connection to reconnect.
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
  const due = Date.parse(secrets.expiresAt ?? "");
  if (type !== "gitlab" || !Number.isFinite(due) || due > Date.now() + 60_000)
    return { secrets, refreshed: null };
  if (!secrets.refreshToken) throw new ProviderCallError(401);
  const token = record(
    await providerJson("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: formHeaders,
      body: form({
        client_id: creds.clientId ?? "",
        client_secret: creds.clientSecret ?? "",
        refresh_token: secrets.refreshToken,
        grant_type: "refresh_token",
        redirect_uri: redirectUri("gitlab"),
      }),
    }).catch((error: unknown) => {
      // A rejected refresh token means the grant is gone: reconnect.
      if (error instanceof ProviderCallError && error.status === 400)
        throw new ProviderCallError(401);
      throw error;
    }),
  );
  const accessToken = text(token.access_token);
  if (!accessToken) throw new ProviderCallError(401);
  const expiresIn = Number(token.expires_in);
  const next = {
    ...secrets,
    accessToken,
    refreshToken: text(token.refresh_token) || secrets.refreshToken,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : "",
  };
  return { secrets: next, refreshed: next };
}

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
