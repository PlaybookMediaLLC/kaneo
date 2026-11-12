import { createGuardedFetch } from "../../import/guarded-fetch";
import { privateDestinationsAllowed } from "../../utils/assert-public-destination";

// Trusted for Quills route modules, like widget/host: the one module through which a route may
// fetch a URL that a user gave. It reads no database and records nothing.
// support/link-preview.test.ts pins its import list. The guard checks every hop and the socket's
// DNS answer, so a private, loopback, link-local or metadata address, and a redirect to one, is
// refused before a connection.

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
/** Previews that may run at once in this process. A DNS lookup holds one of libuv's 4 threads. */
const MAX_RUNNING = 2;
const HTML = /^\s*(text\/html|application\/xhtml\+xml)\b/i;

type BaseFetch = NonNullable<
  Parameters<typeof createGuardedFetch>[1]
>["baseFetch"];

/** The body text, at most MAX_BYTES, in the charset that the content type names (else UTF-8). */
async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks).subarray(0, MAX_BYTES);
  const charset = /charset=["']?([\w.:-]+)/i.exec(
    response.headers.get("content-type") ?? "",
  )?.[1];
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

async function fetchPage(
  url: string,
  signal: AbortSignal,
  baseFetch?: BaseFetch,
) {
  const guard = createGuardedFetch("Link preview", { baseFetch });
  try {
    const response = await guard.fetch(url, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "user-agent": "KaneoLinkPreview/1.0",
      },
      signal,
    });
    if (
      !response.ok ||
      !HTML.test(response.headers.get("content-type") ?? "")
    ) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    return { url: response.url || url, html: await readLimited(response) };
  } catch {
    return null;
  }
}

let running = 0;

/**
 * The final URL and the first 512 KB of an HTML page, or null for a refused destination, an
 * error, a status that is not 2xx, a body that is not HTML, or no answer within 5 seconds. The
 * deadline also covers the guard's DNS lookups, which take no abort signal. It never throws, and no
 * page or network text leaves it. With `strict`, the operator switch that allows private
 * destinations (KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS) answers null: customers never reach the
 * private network. `baseFetch` is for tests; production uses the guard's own.
 */
export async function fetchHtmlPage(
  url: string,
  options: { strict?: boolean; baseFetch?: BaseFetch } = {},
): Promise<{ url: string; html: string } | null> {
  if (options.strict && privateDestinationsAllowed()) return null;
  // ponytail: a limit per process; with several API instances each has its own.
  if (running >= MAX_RUNNING) return null;
  running++;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // The slot frees when the work ends, not at the deadline: a stuck DNS lookup keeps its thread.
  const work = fetchPage(url, signal, options.baseFetch).finally(() => {
    running--;
  });
  const deadline = new Promise<null>((resolve) =>
    signal.addEventListener("abort", () => resolve(null), { once: true }),
  );
  return Promise.race([work, deadline]);
}
