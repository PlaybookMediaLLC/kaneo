export interface ParsedMailbox {
  address: string;
  name: string;
}

export type ForwardFormat =
  | "directive"
  | "gmail"
  | "outlook"
  | "apple_mail"
  | "rfc822"
  | "generic"
  | "none";

export interface ForwardParseResult {
  isForward: boolean;
  requester: ParsedMailbox | null;
  preamble: string;
  forwardedBody: string;
  subject: string | null;
  cc: ParsedMailbox[];
  parseFailed: boolean;
  format: ForwardFormat;
}

const FORWARD_SUBJECT_RE = /^(?:\s*(?:fwd?|fw)\s*:\s*)+/i;
const REQUESTER_DIRECTIVE_RE = /^\s*#requester\s+([^\r\n]+?)\s*(?:\r?\n|$)/i;
const GMAIL_MARKER_RE = /^-{5,}\s*Forwarded message\s*-{5,}\s*$/im;
const APPLE_MARKER_RE = /^Begin forwarded message:\s*$/im;
const OUTLOOK_ORIGINAL_RE = /^-{4,}\s*Original Message\s*-{4,}\s*$/im;
const OUTLOOK_UNDERSCORE_RE = /^_{10,}\s*$/m;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Parse a single mailbox like `Jane Doe <jane@acme.test>` or `jane@acme.test` or `Jane Doe <mailto:jane@acme.test>`. */
export function parseMailbox(raw: string | undefined): ParsedMailbox | null {
  if (!raw) return null;
  const cleaned = raw.replace(/mailto:/gi, "").trim();
  const angle = /^\s*(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(
    cleaned,
  );
  if (angle) {
    const address = angle[2]!.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return null;
    const name = angle[1]?.trim() || address.split("@")[0]!;
    return { address, name };
  }
  const paren = /^\s*([^\s@<>]+@[^\s@<>]+)\s*\(([^()]*)\)\s*$/.exec(cleaned);
  if (paren) {
    const address = paren[1]!.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return null;
    const name = paren[2]?.trim() || address.split("@")[0]!;
    return { address, name };
  }
  const bracket = /^\s*([^[\]<>]*?)\s*\[([^\][\s]+@[^\][\s]+)\]\s*$/.exec(
    cleaned,
  );
  if (bracket) {
    const address = bracket[2]!.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return null;
    const name = bracket[1]?.trim() || address.split("@")[0]!;
    return { address, name };
  }
  const bare = cleaned.toLowerCase();
  if (/^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/.test(bare) && EMAIL_RE.test(bare)) {
    return { address: bare, name: bare.split("@")[0]! };
  }
  // Fallback: extract embedded address when preceded by display name
  const embedded = EMAIL_RE.exec(cleaned);
  if (embedded) {
    const address = embedded[0]!.toLowerCase();
    const before = cleaned
      .slice(0, embedded.index)
      .replace(/["<>()[\],:]/g, "")
      .trim();
    return { address, name: before || address.split("@")[0]! };
  }
  return null;
}

const MAX_MAILBOX_LIST_CHARS = 8192;

function splitMailboxItems(raw: string): string[] {
  const bounded =
    raw.length > MAX_MAILBOX_LIST_CHARS
      ? raw.slice(0, MAX_MAILBOX_LIST_CHARS)
      : raw;
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;
  for (let i = 0; i < bounded.length; i++) {
    const ch = bounded[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inQuotes) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && (ch === "," || ch === ";")) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Parse a comma/semicolon-separated address list (e.g. `Cc:` header) in O(n) time. */
export function parseMailboxList(
  values: string | readonly string[] | undefined,
): ParsedMailbox[] {
  if (!values) return [];
  const rawList = Array.isArray(values) ? values : [values];
  const seen = new Set<string>();
  const out: ParsedMailbox[] = [];
  for (const item of rawList) {
    for (const part of splitMailboxItems(item)) {
      const parsed = parseMailbox(part);
      if (parsed && !seen.has(parsed.address)) {
        seen.add(parsed.address);
        out.push(parsed);
      }
    }
  }
  return out;
}

export function stripForwardSubject(subject: string | undefined): {
  cleaned: string | null;
  hadForwardPrefix: boolean;
} {
  if (!subject) return { cleaned: null, hadForwardPrefix: false };
  const trimmed = subject.trim();
  const hadForwardPrefix = FORWARD_SUBJECT_RE.test(trimmed);
  const cleaned = trimmed.replace(FORWARD_SUBJECT_RE, "").trim();
  return { cleaned: cleaned || null, hadForwardPrefix };
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

interface ParsedHeaderBlock {
  fromRaw: string | null;
  from: ParsedMailbox | null;
  subject: string | null;
  cc: ParsedMailbox[];
  body: string;
  headerCount: number;
}

function parseRfc822Message(raw: string): ParsedHeaderBlock {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") index += 1;

  let fromRaw: string | null = null;
  let subject: string | null = null;
  const ccRaw: string[] = [];
  let headerCount = 0;
  let lastKey: string | null = null;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      break;
    }
    if (/^[ \t]+/.test(line) && lastKey) {
      const continuation = line.trim();
      if (lastKey === "from" && fromRaw !== null) fromRaw += ` ${continuation}`;
      else if (lastKey === "subject" && subject !== null)
        subject += ` ${continuation}`;
      else if (lastKey === "cc" && ccRaw.length > 0)
        ccRaw[ccRaw.length - 1] += ` ${continuation}`;
      index += 1;
      continue;
    }
    const headerMatch = /^([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
    if (!headerMatch) break;
    headerCount += 1;
    const key = headerMatch[1]!.toLowerCase();
    const value = headerMatch[2]!.trim();
    lastKey = key;
    if (key === "from" && !fromRaw) fromRaw = value;
    else if (key === "subject" && !subject) subject = value;
    else if (key === "cc") ccRaw.push(value);
    index += 1;
  }

  return {
    fromRaw,
    from: parseMailbox(fromRaw ?? undefined),
    subject,
    cc: parseMailboxList(ccRaw),
    body: lines.slice(index).join("\n").trim(),
    headerCount,
  };
}

function parseForwardedHeaderBlock(afterMarker: string): ParsedHeaderBlock {
  const lines = afterMarker.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index]!.trim() === "") index += 1;

  let fromRaw: string | null = null;
  let subject: string | null = null;
  const ccRaw: string[] = [];
  let headerCount = 0;

  while (index < lines.length) {
    const rawLine = lines[index]!;
    const trimmed = rawLine.replace(/^>+\s*/, "").trim();
    if (trimmed === "") {
      if (headerCount > 0) {
        index += 1;
        break;
      }
      index += 1;
      continue;
    }
    const headerMatch =
      /^(From|Sent|Date|To|Cc|CC|Bcc|BCC|Subject|Reply-To|Importance|Attachments)\s*:\s*(.*)$/i.exec(
        trimmed,
      );
    if (!headerMatch) break;
    headerCount += 1;
    const key = headerMatch[1]!.toLowerCase();
    const value = headerMatch[2]!.trim();
    if (key === "from" && !fromRaw) fromRaw = value;
    else if (key === "subject" && !subject) subject = value;
    else if (key === "cc") ccRaw.push(value);
    index += 1;
  }

  const body = lines.slice(index).join("\n").trim();
  return {
    fromRaw,
    from: parseMailbox(fromRaw ?? undefined),
    subject,
    cc: parseMailboxList(ccRaw),
    body,
    headerCount,
  };
}

function dedupeMailboxes(
  lists: readonly (readonly ParsedMailbox[])[],
): ParsedMailbox[] {
  const seen = new Set<string>();
  const result: ParsedMailbox[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.address)) {
        seen.add(item.address);
        result.push(item);
      }
    }
  }
  return result;
}

/**
 * Parses a teammate-forwarded email to recover the real customer requester,
 * clean subject, teammate preamble (internal note), customer body, and CCs.
 * Supports explicit `#requester` directives, Gmail, Outlook Web/Desktop,
 * Apple Mail, and RFC 822 forwarded blocks.
 */
export function parseForwardedEmail(input: {
  subject?: string;
  text?: string;
  html?: string;
  cc?: readonly string[];
  rfc822Text?: string;
}): ForwardParseResult {
  const { cleaned: cleanedSubject, hadForwardPrefix } = stripForwardSubject(
    input.subject,
  );
  const headerCc = parseMailboxList(input.cc);
  const rawBody = (
    input.text && input.text.trim()
      ? input.text
      : input.html
        ? htmlToPlainText(input.html)
        : ""
  ).replace(/\r\n/g, "\n");

  // 1. Explicit `#requester` directive overrides everything else cleanly.
  const directiveMatch = REQUESTER_DIRECTIVE_RE.exec(rawBody);
  const directiveRequester = directiveMatch
    ? parseMailbox(directiveMatch[1])
    : null;
  const bodyWithoutDirective = directiveMatch
    ? rawBody.slice(directiveMatch[0].length).trimStart()
    : rawBody;

  // 2. Check attached RFC 822 forwarded message if supplied.
  if (input.rfc822Text) {
    const rfcBlock = parseRfc822Message(input.rfc822Text);
    const requester = directiveRequester ?? rfcBlock.from;
    const cc = dedupeMailboxes([headerCc, rfcBlock.cc]);
    return {
      isForward: true,
      requester,
      preamble: bodyWithoutDirective.trim(),
      forwardedBody: rfcBlock.body || bodyWithoutDirective.trim(),
      subject: rfcBlock.subject || cleanedSubject,
      cc,
      parseFailed: requester === null,
      format: directiveRequester ? "directive" : "rfc822",
    };
  }

  // 3. Match standard client forward markers (earliest marker in body wins).
  const markers: { regex: RegExp; format: ForwardFormat }[] = [
    { regex: GMAIL_MARKER_RE, format: "gmail" },
    { regex: APPLE_MARKER_RE, format: "apple_mail" },
    { regex: OUTLOOK_ORIGINAL_RE, format: "outlook" },
    { regex: OUTLOOK_UNDERSCORE_RE, format: "outlook" },
  ];

  let bestMatch: {
    index: number;
    length: number;
    format: ForwardFormat;
  } | null = null;
  for (const candidate of markers) {
    const match = candidate.regex.exec(bodyWithoutDirective);
    if (match && (!bestMatch || match.index < bestMatch.index)) {
      bestMatch = {
        index: match.index,
        length: match[0].length,
        format: candidate.format,
      };
    }
  }

  if (bestMatch) {
    const preamble = bodyWithoutDirective.slice(0, bestMatch.index).trim();
    const afterMarker = bodyWithoutDirective.slice(
      bestMatch.index + bestMatch.length,
    );
    const block = parseForwardedHeaderBlock(afterMarker);
    const requester = directiveRequester ?? block.from;
    const cc = dedupeMailboxes([headerCc, block.cc]);
    return {
      isForward: true,
      requester,
      preamble,
      forwardedBody: block.body || afterMarker.trim(),
      subject: block.subject || cleanedSubject,
      cc,
      parseFailed: requester === null,
      format: directiveRequester ? "directive" : bestMatch.format,
    };
  }

  // 4. Generic forwarded header block (From: + Date/Sent/Subject:) when subject has Fwd:/Fw:
  if (hadForwardPrefix) {
    const genericStart = /(?:^|\n)(?:>+\s*)?From\s*:/i.exec(
      bodyWithoutDirective,
    );
    if (genericStart) {
      const startIndex = genericStart[0].startsWith("\n")
        ? genericStart.index + 1
        : genericStart.index;
      const preamble = bodyWithoutDirective.slice(0, startIndex).trim();
      const block = parseForwardedHeaderBlock(
        bodyWithoutDirective.slice(startIndex),
      );
      if (block.headerCount >= 2) {
        const requester = directiveRequester ?? block.from;
        return {
          isForward: true,
          requester,
          preamble,
          forwardedBody: block.body || bodyWithoutDirective.trim(),
          subject: block.subject || cleanedSubject,
          cc: dedupeMailboxes([headerCc, block.cc]),
          parseFailed: requester === null,
          format: directiveRequester ? "directive" : "generic",
        };
      }
    }
  }

  // 5. Directive only (no forward header marker)
  if (directiveRequester) {
    return {
      isForward: true,
      requester: directiveRequester,
      preamble: "",
      forwardedBody: bodyWithoutDirective.trim(),
      subject: cleanedSubject,
      cc: headerCc,
      parseFailed: false,
      format: "directive",
    };
  }

  // 6. Subject had Fwd:/Fw: but we couldn't parse any original sender block
  if (hadForwardPrefix) {
    return {
      isForward: true,
      requester: null,
      preamble: "",
      forwardedBody: bodyWithoutDirective.trim(),
      subject: cleanedSubject,
      cc: headerCc,
      parseFailed: true,
      format: "none",
    };
  }

  return {
    isForward: false,
    requester: null,
    preamble: "",
    forwardedBody: rawBody.trim(),
    subject: cleanedSubject,
    cc: headerCc,
    parseFailed: false,
    format: "none",
  };
}
