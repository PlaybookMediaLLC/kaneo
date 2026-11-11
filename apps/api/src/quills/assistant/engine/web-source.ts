import { eq } from "drizzle-orm";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { assistantWebSources } from "../../../database/quills/schema/assistant-web-sources";
import { createGuardedFetch } from "../../../import/guarded-fetch";
import { recordQuillsChange } from "../../events";
import { nothing, type Work } from "./shared";

// assistant_web_source.added: fetches the page through Kaneo's public-destination guard (every
// redirect and the socket's DNS answer are checked) and stores its text. A failure leaves the
// content empty and moves fetched_at, which the list shows as `failed`. It is not retried.

const MAX_BYTES = 1_000_000;
const MAX_TEXT = 50_000;
const TIMEOUT_MS = 10_000;

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? all;
    const point = Number.parseInt(
      code.slice(code[1] === "x" ? 2 : 1),
      code[1] === "x" ? 16 : 10,
    );
    return Number.isFinite(point) && point > 0 && point < 0x110000
      ? String.fromCodePoint(point)
      : all;
  });

/** The title and readable text of an HTML or plain-text page. */
export function pageText(body: string, html: boolean) {
  if (!html) return { title: null, text: body.replace(/\s+/g, " ").trim() };
  const title = /<title[^<>]*>([^<]*)/i.exec(body)?.[1];
  const text = body
    // Linear patterns: a hostile page must not hold the event loop.
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?(?:<\/\1>|$)/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^<>]*>/g, " ");
  return {
    title: title ? decode(title).replace(/\s+/g, " ").trim() || null : null,
    text: decode(text)
      .replace(/[^\S\n]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim(),
  };
}

async function readLimited(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) break;
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchPage(url: string) {
  const guard = createGuardedFetch("Web source");
  try {
    const response = await guard.fetch(url, {
      headers: { accept: "text/html, text/plain;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = response.headers.get("content-type") ?? "";
    const html = /text\/html|application\/xhtml/i.test(type);
    if (!response.ok || (!html && !/text\/plain/i.test(type))) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const page = pageText(await readLimited(response), html);
    return page.text ? page : null;
  } catch {
    // Destination refusals, timeouts and network errors all leave the source failed.
    return null;
  }
}

export const fetchWebSource: Work = async (workspaceId, event) => {
  const [source] = await withQuillsSystemWorkspace(workspaceId, (db) =>
    db
      .select({ id: assistantWebSources.id, url: assistantWebSources.url })
      .from(assistantWebSources)
      .where(eq(assistantWebSources.id, event.entityId as never)),
  );
  if (!source) return nothing;
  const page = await fetchPage(source.url);
  return async (db) => {
    const [row] = await db
      .update(assistantWebSources)
      .set({
        fetchedAt: new Date(),
        updatedAt: new Date(),
        ...(page && {
          content: page.text.slice(0, MAX_TEXT),
          ...(page.title && { title: page.title.slice(0, 200) }),
        }),
      })
      .where(eq(assistantWebSources.id, source.id))
      .returning({ id: assistantWebSources.id });
    if (row)
      await recordQuillsChange(db, null, {
        type: "assistant_web_source.fetched",
        entityType: "assistant_web_source",
        entityId: row.id,
        payload: { status: page ? "ready" : "failed" },
      });
  };
};
