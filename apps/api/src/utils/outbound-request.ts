import { destinationFetch } from "../import/destination-fetch";
import { isBlockedDestinationError } from "../import/blocked-destination-error";
import { DestinationLookupError } from "./destination-lookup-error";
import { assertPublicDestination } from "./assert-public-destination";
import { withoutOutboundTelemetry } from "./sensitive-outbound";

type Failure = "timeout" | "http" | "network" | "response" | "destination";

// Never attach the original error/cause: it can include credential-bearing
// URLs, authorization headers or untrusted response bodies.
export class OutboundRequestError extends Error {
  constructor(
    readonly reason: Failure,
    readonly status?: number,
    readonly snippet?: string,
  ) {
    super(
      `Outbound request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`,
    );
  }
}

export function safeOutboundError(error: unknown): string {
  return error instanceof OutboundRequestError
    ? error.message
    : "Outbound request failed";
}

async function readBoundedSnippet(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const cap = Math.max(0, Math.min(maxBytes, 2048));
  if (cap === 0 || !response.body) {
    void response.body?.cancel().catch(() => {});
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, cap - size);
      chunks.push(take === value.byteLength ? value : value.subarray(0, take));
      size += take;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    let out = "";
    for (let i = 0; i < decoded.length; i++) {
      const code = decoded.charCodeAt(i);
      if (
        (code >= 0x20 && code !== 0x7f) ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0d
      ) {
        out += decoded[i];
      }
    }
    return out;
  } catch {
    return "";
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readSmallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new OutboundRequestError("response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new OutboundRequestError("response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OutboundRequestError("response");
    }
  } finally {
    // Cancellation need not wait for the remote peer to close its stream.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function sendOutboundRequest(
  url: string,
  init: Pick<RequestInit, "headers" | "body">,
  options: {
    readJson?: boolean;
    readStatus?: boolean;
    readSnippetBytes?: number;
    publicDestination?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutboundRequestError("timeout"));
    }, options.timeoutMs ?? 10_000);
  });
  const request = async () => {
    if (options.publicDestination) {
      try {
        await assertPublicDestination(url, "Notification");
      } catch (error) {
        throw new OutboundRequestError(
          error instanceof DestinationLookupError ? "network" : "destination",
        );
      }
    }
    // DNS validation may finish after the deadline. Never start a late request.
    controller.signal.throwIfAborted();
    // Check the DNS answers used by the socket too, including new connections
    // after a pooled connection closes. A preflight alone permits rebinding.
    const send = options.publicDestination ? destinationFetch : fetch;
    const response = await withoutOutboundTelemetry(() =>
      send(url, {
        ...init,
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
      }),
    );
    if (options.readSnippetBytes !== undefined) {
      const snippet = await readBoundedSnippet(
        response,
        options.readSnippetBytes,
      );
      if (!response.ok)
        throw new OutboundRequestError("http", response.status, snippet);
      return { status: response.status, snippet };
    }
    if (!response.ok || !options.readJson) {
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new OutboundRequestError("http", response.status);
      return options.readStatus ? response.status : undefined;
    }
    return readSmallJson(response);
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw new OutboundRequestError("timeout");
    if (isBlockedDestinationError(error)) {
      throw new OutboundRequestError("destination");
    }
    if (error instanceof OutboundRequestError) throw error;
    throw new OutboundRequestError("network");
  } finally {
    clearTimeout(timer);
  }
}
