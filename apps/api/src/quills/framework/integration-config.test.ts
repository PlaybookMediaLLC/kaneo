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

/** An answer of `total` bytes (endless without it), in chunks, that counts what was read from it. */
function stream(total = Infinity) {
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

  it("refuses an answer over the limit with a fixed 502 and stops reading it", async () => {
    const endless = stream();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(endless.body),
    );
    const error = await providerJson(URL_, {}, hosts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderCallError);
    expect((error as ProviderCallError).status).toBe(502);
    expect((error as Error).message).toBe("Provider answered 502");
    expect(endless.seen.read).toBeGreaterThan(CAP);
    // At most the chunk that crossed the limit and one that the stream queued ahead.
    expect(endless.seen.read).toBeLessThanOrEqual(CAP + 2 * CHUNK);
    expect(endless.seen.cancelled).toBe(true);

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
    // An aborted signal stops at once; work that ends first wins; no signal: the work itself.
    await expect(
      beforeDeadline(new Promise(() => {}), AbortSignal.abort()),
    ).rejects.toBeInstanceOf(HTTPException);
    await expect(
      beforeDeadline(Promise.resolve(1), new AbortController().signal),
    ).resolves.toBe(1);
    const work = Promise.resolve(2);
    expect(beforeDeadline(work)).toBe(work);
  });
});
