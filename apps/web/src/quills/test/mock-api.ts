import { afterEach } from "vite-plus/test";
import { quillsOperationRoutes } from "./operation-routes";

interface PreparedReply {
  status: number;
  body: unknown;
  headers?: HeadersInit;
  error?: Error;
  deferred?: (controls: {
    resolve: (body: unknown, status?: number) => void;
    reject: (error: Error) => void;
  }) => void;
}

interface OperationRoute {
  method: string;
  path: RegExp;
}

const operationRoutes = new Map<string, OperationRoute>();
for (const route of quillsOperationRoutes) {
  const expression = route.path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  operationRoutes.set(route.operationId, {
    method: route.method,
    path: new RegExp(`^${expression}$`),
  });
}

export function mockApi() {
  const original = globalThis.fetch;
  const replies: PreparedReply[] = [];
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const reply = replies.shift();
    if (!reply)
      throw new Error(
        `Unexpected API request: ${request.method} ${request.url}`,
      );
    if (reply.error) throw reply.error;
    if (reply.deferred)
      return new Promise<Response>((resolve, reject) =>
        reply.deferred?.({
          resolve: (body, status = 200) =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { "content-type": "application/json" },
              }),
            ),
          reject,
        }),
      );
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  afterEach(() => {
    globalThis.fetch = original;
  });
  return {
    reply(body: unknown, status = 200, headers?: HeadersInit) {
      replies.push({ body, status, headers });
    },
    fail(error = new Error("Network unavailable")) {
      replies.push({ body: null, status: 0, error });
    },
    defer(
      ready: (controls: {
        resolve: (body: unknown, status?: number) => void;
        reject: (error: Error) => void;
      }) => void,
    ) {
      replies.push({ body: null, status: 0, deferred: ready });
    },
    calls(operationId?: string) {
      if (!operationId) return requests;
      const route = operationRoutes.get(operationId);
      if (!route) throw new Error(`Unknown OpenAPI operation: ${operationId}`);
      return requests.filter(
        (request) =>
          request.method === route.method &&
          route.path.test(new URL(request.url).pathname),
      );
    },
  };
}
