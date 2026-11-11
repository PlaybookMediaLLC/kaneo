import { createGuardedFetch } from "../../import/guarded-fetch";

// Trusted for Quills route modules, like widget/host: the only Quills module that fetches a URL
// that a user gave. It reads no database and records nothing. support/link-preview.test.ts pins
// its import list. The guard checks every hop and the socket's DNS answer, so a private, loopback,
// link-local or metadata address, and a redirect to one, is refused before a connection.

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const HTML = /^\s*(text\/html|application\/xhtml\+xml)\b/i;

type BaseFetch = NonNullable<
  Parameters<typeof createGuardedFetch>[1]
>["baseFetch"];

/** At most MAX_BYTES of the body as text. The rest is never read. */
async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = MAX_BYTES - size;
      chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
      size += Math.min(value.byteLength, room);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The final URL and the first 512 KB of an HTML page, or null for a refused destination, an
 * error, a timeout, a status that is not 2xx or a body that is not HTML. It never throws, and no
 * provider or network text leaves it. `baseFetch` is for tests; production uses the guard's own.
 */
export async function fetchHtmlPage(
  url: string,
  baseFetch?: BaseFetch,
): Promise<{ url: string; html: string } | null> {
  const guard = createGuardedFetch("Link preview", { baseFetch });
  try {
    const response = await guard.fetch(url, {
      headers: {
        accept: "text/html, application/xhtml+xml",
        "user-agent": "KaneoLinkPreview/1.0",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
