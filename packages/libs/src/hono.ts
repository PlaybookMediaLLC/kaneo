/// <reference types="vite/types/importMeta.d.ts" />

import type {
  AppType,
  QuillsPublicRouters,
  QuillsTeammateRouters,
} from "@kaneo/api";
import { brandText } from "@kaneo/branding";
import type { Hono } from "hono";
import { hc } from "hono/client";
import { resolveApiBaseUrl } from "./api-url";

const apiUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);

// Generate once per tab load
export const windowId = Math.random().toString(36).substring(2, 11);
// Must match the API's header name, or every change echoes back to its own window.
const windowIdHeader = brandText("X-Kaneo-Window-Id");

// Named type: the inferred client type is too large to emit inline (TS7056).
export const client: ReturnType<typeof hc<AppType>> = hc<AppType>(apiUrl, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    return fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        "Content-Type": "application/json",
        [windowIdHeader]: windowId,
      },
      credentials: "include",
    }).catch((error) => {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error(
          `Failed to connect to API server at ${apiUrl}. This might be due to CORS configuration issues or the server not running. Please check your environment variables and server status.`,
        );
      }
      throw error;
    });
  },
});

type IntersectClients<T extends readonly Hono<any, any, any>[]> =
  T extends readonly [
    infer A extends Hono<any, any, any>,
    infer B extends Hono<any, any, any>,
    infer C extends Hono<any, any, any>,
    infer D extends Hono<any, any, any>,
    ...infer Rest extends readonly Hono<any, any, any>[],
  ]
    ? ReturnType<typeof hc<A>> &
        ReturnType<typeof hc<B>> &
        ReturnType<typeof hc<C>> &
        ReturnType<typeof hc<D>> &
        IntersectClients<Rest>
    : T extends readonly [
          infer Head extends Hono<any, any, any>,
          ...infer Tail extends readonly Hono<any, any, any>[],
        ]
      ? ReturnType<typeof hc<Head>> & IntersectClients<Tail>
      : unknown;

type QuillsClientType = {
  quills: IntersectClients<QuillsTeammateRouters>;
  "quills-public": IntersectClients<QuillsPublicRouters>;
};

// Separate typed view for Quills routes built from flat per-router intersections, avoiding
// Hono's exponential type expansion across a 47-deep .route() chain during apps/web typecheck.
export const quillsClient = client as unknown as QuillsClientType;
