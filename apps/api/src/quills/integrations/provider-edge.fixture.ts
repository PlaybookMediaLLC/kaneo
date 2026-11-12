import { createServer, type IncomingMessage } from "node:http";
import { vi } from "vite-plus/test";
import { oauthProviders } from "./providers";

/**
 * The provider HTTP edge for contract checks. A credential check to a P7a provider host gets a small
 * JSON answer. A request to an OAuth provider host (the `hosts` of each provider in providers/, and
 * Resend) goes to a local HTTP server, at `/<host><path>`, which answers like the provider. Every
 * other request goes to the real fetch.
 */
export const providerCalls: {
  method: string;
  path: string;
  body: string;
  authorization: string;
}[] = [];

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });

/**
 * Answers that a provider's own fixture file adds, by `METHOD /<host><path>`; undefined when it does
 * not know the route. A new provider adds its answers here, not in providerAnswer.
 */
export const providerAnswers: ((route: string) => unknown)[] = [];

/** The answers of the local provider server, by method and `/<host><path>` without the query. */
export function providerAnswer(method: string, path: string): unknown {
  const route = `${method} ${path}`;
  for (const answer of providerAnswers) {
    const value = answer(route);
    if (value !== undefined) return value;
  }
  if (route === "POST /github.com/login/oauth/access_token")
    return { access_token: "gho_contract_token" };
  if (route === "GET /api.github.com/user")
    return { login: "contract", name: "Contract" };
  if (route === "GET /api.github.com/user/repos")
    return [{ full_name: "acme/app" }, { full_name: "acme/site" }];
  if (route === "GET /api.github.com/search/issues")
    return {
      items: [
        {
          number: 7,
          title: "Contract issue",
          html_url: "https://github.com/acme/app/issues/7",
          state: "open",
        },
      ],
    };
  if (/^POST \/api\.github\.com\/repos\/[^/]+\/[^/]+\/hooks$/.test(route))
    return { id: 101 };
  if (/^POST \/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues$/.test(route))
    return { number: 7, html_url: "https://github.com/acme/app/issues/7" };
  if (route === "POST /gitlab.com/oauth/token")
    return {
      access_token: "glpat_contract_token",
      refresh_token: "glrt_contract_token",
      expires_in: 7200,
    };
  if (route === "GET /gitlab.com/api/v4/user")
    return { username: "contract", name: "Contract" };
  if (route === "POST /slack.com/api/oauth.v2.access")
    return {
      ok: true,
      access_token: "xoxb-contract-token",
      team: { id: "T1", name: "Contract" },
    };
  if (route === "GET /slack.com/api/conversations.list")
    return { ok: true, channels: [{ id: "C1", name: "general" }] };
  if (route === "POST /slack.com/api/chat.postMessage")
    return { ok: true, ts: "1.1" };
  if (route === "POST /discord.com/api/oauth2/token")
    return {
      access_token: "discord-user-token",
      guild: { id: "42", name: "Contract" },
    };
  if (route.startsWith("GET /api.resend.com/emails/receiving/"))
    return { text: "Body from Resend" };
  return undefined;
}

/** Per-test answers by `METHOD /<host><path>`. `drop` closes the socket: no answer arrives. */
export const providerOverrides = new Map<
  string,
  { status: number; body?: unknown } | "drop"
>();

const server = createServer(async (request, response) => {
  const path = (request.url ?? "/").split("?")[0]!;
  providerCalls.push({
    method: request.method ?? "GET",
    path: request.url ?? "/",
    body: await read(request),
    authorization: request.headers.authorization ?? "",
  });
  const override = providerOverrides.get(`${request.method} ${path}`);
  if (override === "drop") return void request.socket.destroy();
  if (override) {
    response.writeHead(override.status, { "content-type": "application/json" });
    return void response.end(JSON.stringify(override.body ?? {}));
  }
  const answer = providerAnswer(request.method ?? "GET", path);
  response.writeHead(answer === undefined ? 404 : 200, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(answer ?? { message: "Not found" }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
server.unref();
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

const real = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    /^(api\.stripe\.com|api\.app\.shortcut\.com|[a-z0-9-]+\.freshdesk\.com)$/.test(
      url.hostname,
    )
  )
    return Response.json({
      name: "Contract desk",
      workspace2: { name: "Contract", url_slug: "contract" },
    });
  if (
    url.hostname === "api.resend.com" ||
    Object.values(oauthProviders).some((provider) =>
      provider.hosts.test(url.hostname),
    )
  )
    return real(`${base}/${url.hostname}${url.pathname}${url.search}`, {
      ...init,
      redirect: "manual",
    });
  return real(input, init);
});
