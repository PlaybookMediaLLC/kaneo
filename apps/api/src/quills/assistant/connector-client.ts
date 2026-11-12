import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  type CachedConnectorTool,
  type ConnectorAuthMode,
  type ConnectorToolPolicies,
} from "../../database/quills/schema/connectors";
import { destinationFetch } from "../../import/destination-fetch";
import { createGuardedFetch } from "../../import/guarded-fetch";

// The MCP client of assistant connectors. A connector URL comes from a teammate, so each request
// goes through the destination guard: every redirect and the socket address are checked. Each step
// has one deadline, and each answer has a size limit. This module never opens a transaction: a route
// reads, calls one function here, then writes. Secrets go in and come out as plain values; the
// route seals them. Server text never leaves this module: a failure is one of four kinds. A tool
// result is the one exception: `callTool` returns its text, bounded, as data for the model.

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
export const MAX_TOOLS = 100;
const MAX_SCHEMA = 20_000;
/** The characters of a tool result that reach the model. */
export const MAX_RESULT = 8_000;

/** Plain secrets: `bearerToken`; for OAuth `client` and `tokens` (the SDK's JSON) and `codeVerifier`. */
export type Secrets = Record<string, string>;
export type Target = {
  url: string;
  authMode: ConnectorAuthMode;
  secrets: Secrets;
  /** The connector's signed callback. Needed for OAuth only. */
  redirectUrl?: string;
};
/** destination: the guard refused the address. rejected: the authorization server refused the request. */
export type Failure =
  | "destination"
  | "unauthorized"
  | "rejected"
  | "unreachable";
export type DiscoveredTool = Omit<CachedConnectorTool, "firstSeenAt">;

/** The socket-level fetch under the guard. Tests point it at a local server; the guard still checks each URL. */
export const connectorSocket = { fetch: destinationFetch };

/** An answer whose body fails after MAX_BYTES. */
function capped(response: Response) {
  if (!response.body) return response;
  let size = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_BYTES)
          controller.error(new Error("The MCP server's answer is too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, response);
}

/** The fetch of one step: guarded, under one deadline, with capped answers. */
function edge(timeoutMs = TIMEOUT_MS) {
  const guard = createGuardedFetch("MCP server", {
    baseFetch: (url, init) => connectorSocket.fetch(url, init),
  });
  const deadline = AbortSignal.timeout(Math.min(timeoutMs, TIMEOUT_MS));
  const fetch: FetchLike = async (url, init) =>
    capped(
      await guard.fetch(String(url), {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, deadline])
          : deadline,
      }),
    );
  const failure = (error: unknown): Failure =>
    guard.failure()?.kind === "destination"
      ? "destination"
      : error instanceof UnauthorizedError ||
          (error instanceof StreamableHTTPError && error.code === 401)
        ? "unauthorized"
        : error instanceof OAuthError
          ? "rejected"
          : "unreachable";
  return { fetch, failure, deadline };
}

const json = (value: string | undefined) => {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * An OAuth client whose state lives in `secrets`, changed in place. With `state` it can start an
 * authorization; without it, a step that needs a new authorization fails as `unauthorized`.
 */
function oauthClient(secrets: Secrets, redirectUrl: string, state?: string) {
  let authorizationUrl: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: {
      client_name: "Quills",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    ...(state && { state: () => state }),
    // A client registered for another callback URL (the API origin changed) registers again.
    clientInformation: () => {
      const info = json(secrets.client);
      return info?.redirect_uris && !info.redirect_uris.includes(redirectUrl)
        ? undefined
        : info;
    },
    saveClientInformation: (info) => {
      secrets.client = JSON.stringify(info);
    },
    tokens: () => json(secrets.tokens),
    saveTokens: (tokens) => {
      secrets.tokens = JSON.stringify(tokens);
    },
    redirectToAuthorization: (url) => {
      authorizationUrl = url;
    },
    // Only a start keeps a verifier: a refresh must not replace the one of a pending authorization.
    saveCodeVerifier: (verifier) => {
      if (state) secrets.codeVerifier = verifier;
    },
    codeVerifier: () => {
      if (!secrets.codeVerifier) throw new UnauthorizedError();
      return secrets.codeVerifier;
    },
    invalidateCredentials: (scope) => {
      if (scope === "all" || scope === "client") delete secrets.client;
      if (scope === "all" || scope === "tokens") delete secrets.tokens;
      if (scope === "all" || scope === "verifier") delete secrets.codeVerifier;
    },
  };
  return { provider, authorizationUrl: () => authorizationUrl };
}

/** A NUL or a lone surrogate (also one that a cut makes): jsonb refuses both. */
const unstorable =
  /\0|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const text = (value: string | undefined, max: number) =>
  value?.slice(0, max).replace(unstorable, "�");

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
/** The stored part of a tool, bounded: the server is not trusted. */
const bounded = (tools: ListedTool[]): DiscoveredTool[] =>
  tools
    .filter(
      (tool) =>
        tool.name.length >= 1 &&
        tool.name.length <= 128 &&
        !tool.name.match(unstorable),
    )
    .slice(0, MAX_TOOLS)
    .map((tool) => {
      const schema = JSON.stringify(tool.inputSchema);
      return {
        name: tool.name,
        title: text(tool.title, 200),
        description: text(tool.description, 2000),
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint === true,
          destructiveHint: tool.annotations?.destructiveHint === true,
        },
        // JSON escapes a NUL or a lone surrogate as \u0000 or \udXXX.
        inputSchema:
          schema.length <= MAX_SCHEMA && !/\\u(0000|d[89a-f])/i.test(schema)
            ? tool.inputSchema
            : undefined,
      };
    });

/** The transport to `target` with its credentials. OAuth state lives in `secrets`, changed in place. */
function transport(target: Target, secrets: Secrets, fetch: FetchLike) {
  const oauth =
    target.authMode === "oauth"
      ? oauthClient(secrets, target.redirectUrl ?? "")
      : undefined;
  const bearer = target.authMode === "bearer" && secrets.bearerToken;
  return new StreamableHTTPClientTransport(new URL(target.url), {
    fetch,
    authProvider: oauth?.provider,
    ...(bearer && {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }),
  });
}

/**
 * Connects and lists the server's tools (the first page). `secrets` is the state after the step:
 * the SDK may have refreshed the OAuth tokens, or dropped tokens that the server refused.
 */
export async function discover(target: Target) {
  const { fetch, failure, deadline } = edge();
  const secrets = { ...target.secrets };
  const client = new Client({ name: "quills-connectors", version: "1.0.0" });
  try {
    await client.connect(
      transport(target, secrets, fetch),
      // A stalled event stream does not fail the request: the deadline must end it too.
      { signal: deadline },
    );
    const listed = await client.listTools(undefined, { signal: deadline });
    return { secrets, tools: bounded(listed.tools) };
  } catch (error) {
    return { secrets, failure: failure(error) };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Connects and calls one tool, under one deadline of at most 10 seconds. `secrets` is the state
 * after the step: on a 401 the SDK refreshes the OAuth tokens once and sends the request again.
 * `error` means that the tool answered with an error; its text is not returned. `text` is at most
 * MAX_RESULT characters, with NUL and lone surrogates replaced; `size` is the full length.
 */
export async function callTool(
  target: Target,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
) {
  const { fetch, failure, deadline } = edge(timeoutMs);
  const secrets = { ...target.secrets };
  const client = new Client({ name: "quills-connectors", version: "1.0.0" });
  try {
    await client.connect(transport(target, secrets, fetch), {
      signal: deadline,
    });
    const result = await client.callTool({ name, arguments: args }, undefined, {
      signal: deadline,
    });
    if (result.isError) return { secrets, error: true as const };
    const parts = Array.isArray(result.content) ? result.content : [];
    const raw = parts.length
      ? parts
          .map((part) =>
            part.type === "text" ? part.text : "[content that is not text]",
          )
          .join("\n")
      : JSON.stringify(result.structuredContent ?? null);
    return {
      secrets,
      text: text(raw, MAX_RESULT)!,
      size: raw.length,
      truncated: raw.length > MAX_RESULT,
    };
  } catch (error) {
    return { secrets, failure: failure(error) };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Starts a new OAuth authorization: discovery, client registration when needed, and a PKCE
 * verifier. Stored tokens are not used, and they stay in the returned secrets until a callback
 * replaces them.
 */
export async function startAuthorization(target: Target, state: string) {
  const { fetch, failure } = edge();
  const { tokens, ...secrets } = target.secrets;
  const oauth = oauthClient(secrets, target.redirectUrl ?? "", state);
  try {
    await auth(oauth.provider, { serverUrl: target.url, fetchFn: fetch });
  } catch (error) {
    return { failure: failure(error) };
  }
  const url = oauth.authorizationUrl();
  // The browser opens this URL: only HTTPS from the server's metadata.
  if (url?.protocol !== "https:") return { failure: "rejected" as const };
  return {
    authorizationUrl: url.href,
    secrets: { ...secrets, ...(tokens && { tokens }) },
  };
}

/** Exchanges the callback's code for tokens with the stored client and verifier. */
export async function finishAuthorization(target: Target, code: string) {
  const { fetch, failure } = edge();
  const secrets = { ...target.secrets };
  const oauth = oauthClient(secrets, target.redirectUrl ?? "");
  try {
    await auth(oauth.provider, {
      serverUrl: target.url,
      authorizationCode: code,
      fetchFn: fetch,
    });
  } catch (error) {
    return { failure: failure(error) };
  }
  delete secrets.codeVerifier;
  return { secrets };
}

/** The new catalogue: a known tool keeps its first-seen time; overrides of tools that went are removed. */
export function catalog(
  previous: CachedConnectorTool[],
  discovered: DiscoveredTool[],
  policies: Partial<ConnectorToolPolicies> | null,
) {
  const now = new Date().toISOString();
  const seen = new Map(previous.map((tool) => [tool.name, tool.firstSeenAt]));
  const names = new Set(discovered.map((tool) => tool.name));
  return {
    tools: discovered.map((tool) => ({
      ...tool,
      firstSeenAt: seen.get(tool.name) ?? now,
    })),
    toolPolicies: {
      groupDefaults:
        policies?.groupDefaults ??
        DEFAULT_CONNECTOR_TOOL_POLICIES.groupDefaults,
      tools: Object.fromEntries(
        Object.entries(policies?.tools ?? {}).filter(([name]) =>
          names.has(name),
        ),
      ),
    },
  };
}
