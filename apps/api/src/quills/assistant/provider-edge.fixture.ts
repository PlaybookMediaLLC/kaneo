import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { vi } from "vite-plus/test";

/**
 * The AI provider's HTTP edge for tests: a local OpenAI-compatible server. A chat call answers
 * with `{"text": ...}` and an embedding call with constant 1536-dimension vectors, unless a test
 * sets its own `reply`. Importing this module configures the QUILLS_AI_* variables to it.
 */
export type ProviderRequest = {
  path: string;
  body: any;
  authorization?: string;
};
type Answer = { status?: number; json: unknown };
/** A test can hold an answer back, for example until a second request arrives. */
export type Reply = (request: ProviderRequest) => Answer | Promise<Answer>;
export const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

export const chatReply = (content: unknown, toolCalls?: unknown[]) => ({
  json: {
    choices: [
      {
        message: {
          content:
            typeof content === "string" ? content : JSON.stringify(content),
          ...(toolCalls && { tool_calls: toolCalls }),
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  },
});
export const fallback: Reply = ({ path, body }) =>
  path.endsWith("/embeddings")
    ? {
        json: {
          data: (body.input as string[]).map((_, index) => ({
            index,
            embedding: EMBEDDING,
          })),
          usage: { prompt_tokens: 4, total_tokens: 4 },
        },
      }
    : chatReply({ text: "Contract answer" });

let reply: Reply = fallback;
export const provider = {
  requests: [] as ProviderRequest[],
  /** Answers the next calls with `next`; no argument restores the default answers. */
  reply(next?: Reply) {
    reply = next ?? fallback;
  },
};

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    const request = {
      path: req.url ?? "",
      body: raw ? JSON.parse(raw) : null,
      authorization: req.headers.authorization,
    };
    provider.requests.push(request);
    const answer = await reply(request);
    res
      .writeHead(answer.status ?? 200, { "content-type": "application/json" })
      .end(JSON.stringify(answer.json));
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
server.unref();
export const providerUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

vi.stubEnv("QUILLS_AI_BASE_URL", providerUrl);
vi.stubEnv("QUILLS_AI_API_KEY", "contract-provider-key");
vi.stubEnv("QUILLS_AI_MODEL", "contract-model");
vi.stubEnv("QUILLS_AI_EMBEDDING_MODEL", "contract-embedding");
