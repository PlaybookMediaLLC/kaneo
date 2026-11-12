import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { connectors } from "../../database/quills/schema/connectors";
import { encryptSecret } from "../../notification-preferences/secrets";
import type { ContractEnv } from "../framework/contract";
import { connectorSocket } from "./connector-client";

process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-contract-test-key";

/**
 * The connector's HTTP edge for tests: a local MCP server with an OAuth authorization server. A URL
 * on PUBLIC_ORIGIN (a documentation address, so it passes the destination guard) reaches this server
 * at the socket; any other address gets no network. The guard still checks every URL first.
 * Paths: /open/mcp (no auth), /bearer/mcp (BEARER), /oauth/mcp (an access token from /token),
 * /stall/mcp (an event stream that never sends a result).
 */
export const PUBLIC_ORIGIN = "https://203.0.113.10";
export const BEARER = "contract-bearer-token";
export const CODE = "contract-code";
export const REFRESH = "mcp-contract-refresh";
const tool = (name: string, readOnly = false) => ({
  name,
  description: `The ${name} tool`,
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  annotations: { readOnlyHint: readOnly },
});
const DEFAULT_TOOLS = [tool("search", true), tool("create_issue")];

export const edge = {
  /** The tools/list answer. Tests may replace it; `reset` restores the default. */
  tools: DEFAULT_TOOLS as unknown[],
  /** Access tokens the OAuth path accepts. A test removes one to make it expire. */
  access: new Set<string>(),
  issued: 0,
  requests: [] as { method: string; path: string; authorization: string }[],
  /** While set, tools/list waits for it: a test changes the connector during a call. */
  gate: null as Promise<void> | null,
  /** While set, a code exchange must send the verifier of this S256 challenge. */
  challenge: null as string | null,
  /** The advertised authorization endpoint. */
  authorize: `${PUBLIC_ORIGIN}/authorize`,
  reset() {
    this.tools = DEFAULT_TOOLS;
    this.requests = [];
    this.gate = null;
    this.challenge = null;
    this.authorize = `${PUBLIC_ORIGIN}/authorize`;
  },
};

const resourceMetadata = `${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/oauth/mcp`;
type Answer = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function mcp(raw: string): Answer {
  const message = JSON.parse(raw) as {
    id?: number;
    method: string;
    params?: { protocolVersion?: string };
  };
  // A notification gets no answer.
  if (message.id === undefined) return { status: 202 };
  const result =
    message.method === "initialize"
      ? {
          protocolVersion: message.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "contract", version: "1.0.0" },
        }
      : message.method === "tools/list"
        ? { tools: edge.tools }
        : undefined;
  return {
    status: 200,
    body: result
      ? { jsonrpc: "2.0", id: message.id, result }
      : {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        },
  };
}

function tokens() {
  const access = `mcp-contract-access-${++edge.issued}`;
  edge.access.add(access);
  return {
    status: 200,
    body: {
      access_token: access,
      refresh_token: REFRESH,
      token_type: "Bearer",
      expires_in: 3600,
    },
  };
}

function answer(
  method: string,
  path: string,
  raw: string,
  authorization: string,
): Answer {
  if (path === "/open/mcp" || path === "/bearer/mcp" || path === "/oauth/mcp") {
    if (method !== "POST") return { status: 405 };
    if (path === "/bearer/mcp" && authorization !== `Bearer ${BEARER}`)
      return { status: 401 };
    if (
      path === "/oauth/mcp" &&
      !edge.access.has(authorization.replace(/^Bearer /, ""))
    )
      return {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"`,
        },
      };
    return mcp(raw);
  }
  if (`${PUBLIC_ORIGIN}${path}` === resourceMetadata)
    return {
      status: 200,
      body: {
        resource: `${PUBLIC_ORIGIN}/oauth/mcp`,
        authorization_servers: [PUBLIC_ORIGIN],
      },
    };
  if (path === "/.well-known/oauth-authorization-server")
    return {
      status: 200,
      body: {
        issuer: PUBLIC_ORIGIN,
        authorization_endpoint: edge.authorize,
        token_endpoint: `${PUBLIC_ORIGIN}/token`,
        registration_endpoint: `${PUBLIC_ORIGIN}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      },
    };
  if (path === "/register" && method === "POST")
    return {
      status: 201,
      body: { ...JSON.parse(raw), client_id: "contract-client" },
    };
  if (path === "/token" && method === "POST") {
    const form = new URLSearchParams(raw);
    const grant = form.get("grant_type");
    const verifier = form.get("code_verifier") ?? "";
    const s256 = createHash("sha256").update(verifier).digest("base64url");
    if (
      grant === "authorization_code" &&
      form.get("code") === CODE &&
      verifier &&
      (!edge.challenge || s256 === edge.challenge)
    )
      return tokens();
    if (grant === "refresh_token" && form.get("refresh_token") === REFRESH)
      return tokens();
    return { status: 400, body: { error: "invalid_grant" } };
  }
  return { status: 404 };
}

const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", async () => {
    const path = (request.url ?? "/").split("?")[0]!;
    const authorization = request.headers.authorization ?? "";
    edge.requests.push({
      method: request.method ?? "GET",
      path,
      authorization,
    });
    if (edge.gate && raw.includes('"tools/list"')) await edge.gate;
    // Headers, then nothing: the client's deadline must end the request.
    if (path === "/stall/mcp" && request.method === "POST")
      return void response
        .writeHead(200, { "content-type": "text/event-stream" })
        .flushHeaders();
    const result = answer(request.method ?? "GET", path, raw, authorization);
    response.writeHead(result.status, {
      ...(result.body !== undefined && { "content-type": "application/json" }),
      ...result.headers,
    });
    response.end(
      result.body === undefined ? undefined : JSON.stringify(result.body),
    );
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
server.unref();
const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

connectorSocket.fetch = async (url, init) => {
  if (!url.startsWith(`${PUBLIC_ORIGIN}/`))
    throw new TypeError("No network in tests");
  return fetch(`${local}${url.slice(PUBLIC_ORIGIN.length)}`, init);
};

export const VERIFIER = "contract-code-verifier";
/** The secrets of a connector whose authorization was started: a registered client and a verifier. */
export const pendingSecrets = () => ({
  client: JSON.stringify({ client_id: "contract-client" }),
  codeVerifier: VERIFIER,
});

/** A connector on this server in one workspace, with sealed secrets when given. */
export const edgeConnector = (
  env: Pick<ContractEnv, "id" | "scoped">,
  workspaceId: string,
  mode: "open" | "bearer" | "oauth",
  secrets?: Record<string, string>,
) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(connectors)
      .values({
        name: env.id("connector"),
        slug: `c${Math.random().toString(36).slice(2, 12)}`,
        url: `${PUBLIC_ORIGIN}/${mode}/mcp`,
        authMode: mode === "open" ? "none" : mode,
        secrets: secrets && encryptSecret(JSON.stringify(secrets)),
      })
      .returning({ id: connectors.id });
    return row!.id as string;
  });
