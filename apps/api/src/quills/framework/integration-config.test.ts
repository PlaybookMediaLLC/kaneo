import { getEventListeners } from "node:events";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ProviderCallError,
  beforeDeadline,
  providerJson,
} from "./integration-config";

// providerJson's caller deadline and answer size limit, against a stubbed fetch: nothing leaves
// the machine.

const hosts = /^api\.provider\.test$/;
const URL_ = "https://api.provider.test/v1/items";
const CAP = 10 * 1024 * 1024;
const CHUNK = 64 * 1024;

/** An answer of `total` bytes, in chunks, that counts what was read from it. */
function stream(total: number) {
  const seen = { read: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.read >= total) return controller.close();
      const size = Math.min(CHUNK, total - seen.read);
      seen.read += size;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { body, seen };
}

/** A body of `parts`, one chunk each; with `signal`, the body breaks when it aborts, as fetch's does. */
function chunks(parts: Uint8Array[], signal?: AbortSignal) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(signal.reason));
    },
    pull(controller) {
      const part = parts.shift();
      if (part) controller.enqueue(part);
      // Without a signal the body ends; with one it stays open until the signal aborts.
      else if (!signal) controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providerJson", () => {
  it("reads a normal JSON answer as before, and a large legitimate one", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch.mockResolvedValueOnce(Response.json({ results: [{ id: "1" }] }));
    expect(await providerJson(URL_, {}, hosts)).toEqual({
      results: [{ id: "1" }],
    });
    // A list of 100 large records, as GitHub repositories answer, is far under the limit.
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      text: "x".repeat(20_000),
    }));
    fetch.mockResolvedValueOnce(Response.json(items));
    expect(await providerJson(URL_, {}, hosts)).toEqual(items);
    // Not JSON, or no body: null, as before.
    fetch.mockResolvedValueOnce(new Response("<html>"));
    expect(await providerJson(URL_, {}, hosts)).toBeNull();
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await providerJson(URL_, {}, hosts)).toBeNull();
  });

  it("joins an answer that arrives in many chunks, also inside a multi-byte character", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ name: "Zoë Müller", note: "€".repeat(30_000) }),
    );
    // Cut 1 byte into "ë" (2 bytes) and then every 7 KiB, also through the 3-byte "€" signs.
    const cut = new TextEncoder().encode('{"name":"Zo').length + 1;
    const parts = [bytes.subarray(0, cut)];
    for (let at = cut; at < bytes.length; at += 7 * 1024)
      parts.push(bytes.subarray(at, at + 7 * 1024));
    expect(parts.length).toBeGreaterThan(10);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(chunks(parts)),
    );
    expect(await providerJson(URL_, {}, hosts)).toEqual({
      name: "Zoë Müller",
      note: "€".repeat(30_000),
    });
  });

  it("treats a body that the caller's signal ended as no answer, and keeps null without a signal", async () => {
    const part = new TextEncoder().encode('{"results":[');
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(chunks([part], controller.signal)),
    );
    const reading = providerJson(
      URL_,
      { signal: controller.signal },
      hosts,
    ).catch((e: unknown) => e);
    setTimeout(() => controller.abort(), 20);
    const error = await reading;
    expect(error).toBeInstanceOf(ProviderCallError);
    expect((error as ProviderCallError).status).toBeNull();

    // Without a caller signal, a broken body stays null, as before.
    const broken = new AbortController();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(chunks([part], broken.signal)),
    );
    const plain = providerJson(URL_, {}, hosts);
    setTimeout(() => broken.abort(), 20);
    expect(await plain).toBeNull();
  });

  it("refuses an answer over the limit with a fixed 502 and stops reading it", async () => {
    // 1 MiB over the limit: without the limit, all of it would be read.
    const over = stream(CAP + 1024 * 1024);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(over.body),
    );
    const error = await providerJson(URL_, {}, hosts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderCallError);
    expect((error as ProviderCallError).status).toBe(502);
    expect((error as Error).message).toBe("Provider answered 502");
    expect(over.seen.read).toBeGreaterThan(CAP);
    // At most the chunk that crossed the limit and one that the stream queued ahead.
    expect(over.seen.read).toBeLessThanOrEqual(CAP + 2 * CHUNK);
    expect(over.seen.cancelled).toBe(true);

    // An answer of exactly the limit is still read.
    const full = stream(CAP);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(full.body),
    );
    await expect(providerJson(URL_, {}, hosts)).resolves.toBeNull();
    expect(full.seen.read).toBe(CAP);
  });

  it("ends the request when the caller's signal aborts, long before its own timeout", async () => {
    let seen: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(seen!.reason));
        }),
    );
    const started = Date.now();
    const error = await providerJson(
      URL_,
      { signal: AbortSignal.timeout(50) },
      hosts,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderCallError);
    expect((error as ProviderCallError).status).toBeNull();
    expect(seen?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("beforeDeadline", () => {
  it("answers a fixed 502 at the deadline, even for work that never ends", async () => {
    const controller = new AbortController();
    const waiting = beforeDeadline(new Promise(() => {}), controller.signal);
    controller.abort();
    const error = await waiting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(502);
    expect((error as HTTPException).message).toBe(
      "The provider did not answer in time. Try again.",
    );
    // An aborted signal stops at once; no signal: the work itself.
    await expect(
      beforeDeadline(new Promise(() => {}), AbortSignal.abort()),
    ).rejects.toBeInstanceOf(HTTPException);
    // Work that ends first wins, and its listener goes with it.
    const open = new AbortController().signal;
    await expect(beforeDeadline(Promise.resolve(1), open)).resolves.toBe(1);
    expect(getEventListeners(open, "abort")).toHaveLength(0);
    const work = Promise.resolve(2);
    expect(beforeDeadline(work)).toBe(work);
  });
});
