/**
 * Pure detector for automated inbound email (out-of-office auto-replies, bounces,
 * DSNs, mailing lists, and no-reply senders). Used by:
 * - `#311` (never reopen closed tickets/conversations on OOO or bounce replies)
 * - `#331` (never send an auto-acknowledge reply to automated mail / loops)
 */

export interface AutomatedMailInput {
  from?: string;
  subject?: string;
  body?: string;
  headers?:
    | Record<string, string | readonly string[] | undefined>
    | readonly { name: string; value: string }[];
}

export interface AutomatedMailResult {
  /** True for OOO/bounce/DSN/mailing-list/noreply mail that must not reopen closed conversations (#311). */
  isAutomated: boolean;
  /** True when outbound auto-acknowledgements must be suppressed (#331), including Exchange X-Auto-Response-Suppress. */
  suppressAutoAck: boolean;
  reason: string | null;
}

function headerValues(
  headers: AutomatedMailInput["headers"],
  name: string,
): string[] {
  if (!headers) return [];
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    return headers
      .filter((h) => h.name.toLowerCase() === lower)
      .map((h) => h.value.trim());
  }
  const out: string[] = [];
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower || val === undefined) continue;
    if (Array.isArray(val)) out.push(...val.map((v) => String(v).trim()));
    else out.push(String(val).trim());
  }
  return out;
}

const AUTOMATED_LOCAL_PART_RE =
  /^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|auto-?reply|notifications?)(?:\+|$)/i;

const OOO_SUBJECT_RE =
  /\b(?:out of office|automatic reply|auto-?reply|away from (?:the )?office|vacation reply|on vacation|undeliverable|delivery status notification|returned mail|mail delivery failed|failure notice)\b/i;

const OOO_BODY_RE =
  /\b(?:i am (?:currently )?out of (?:the )?office|this is an automated (?:reply|response|message)|thank you for your email\.? i will be out of|delivery has failed to these recipients|your message could not be delivered)\b/i;

const FALSY_HEADER_RE = /^(?:no|false|0|none)$/i;

export function detectAutomatedEmail(
  input: AutomatedMailInput,
): AutomatedMailResult {
  // 1. RFC 3834 Auto-Submitted header
  for (const val of headerValues(input.headers, "auto-submitted")) {
    if (val && val.toLowerCase() !== "no") {
      return {
        isAutomated: true,
        suppressAutoAck: true,
        reason: `auto-submitted:${val.toLowerCase()}`,
      };
    }
  }

  // 2. Precedence: bulk | junk | list | auto_reply
  for (const val of headerValues(input.headers, "precedence")) {
    if (/^(?:bulk|junk|list|auto[_-]?reply)$/i.test(val)) {
      return {
        isAutomated: true,
        suppressAutoAck: true,
        reason: `precedence:${val.toLowerCase()}`,
      };
    }
  }

  // 3. X-Autoreply / X-Autorespond (ignore explicit falsy values like "no" / "false")
  for (const val of headerValues(input.headers, "x-autoreply")) {
    if (val && !FALSY_HEADER_RE.test(val)) {
      return {
        isAutomated: true,
        suppressAutoAck: true,
        reason: "x-autoreply",
      };
    }
  }
  for (const val of headerValues(input.headers, "x-autorespond")) {
    if (val && !FALSY_HEADER_RE.test(val)) {
      return {
        isAutomated: true,
        suppressAutoAck: true,
        reason: "x-autorespond",
      };
    }
  }

  // 4. Mailing lists (List-Id or List-Post)
  if (
    headerValues(input.headers, "list-id").length > 0 ||
    headerValues(input.headers, "list-post").length > 0
  ) {
    return {
      isAutomated: true,
      suppressAutoAck: true,
      reason: "mailing-list",
    };
  }

  // 5. Return-Path: <> (null reverse-path = bounce/DSN per RFC 5321)
  for (const val of headerValues(input.headers, "return-path")) {
    if (val === "<>" || val === "") {
      return {
        isAutomated: true,
        suppressAutoAck: true,
        reason: "null-return-path",
      };
    }
  }

  // 6. Automated sender local-parts (noreply, mailer-daemon, postmaster)
  const fromMatch = /([^<>\s@]+)@[^<>\s@]+/.exec(input.from ?? "");
  if (fromMatch && AUTOMATED_LOCAL_PART_RE.test(fromMatch[1]!)) {
    return {
      isAutomated: true,
      suppressAutoAck: true,
      reason: "automated-sender",
    };
  }

  // 7. Subject / body OOO & bounce heuristics
  if (input.subject && OOO_SUBJECT_RE.test(input.subject)) {
    return {
      isAutomated: true,
      suppressAutoAck: true,
      reason: "ooo-subject",
    };
  }
  if (input.body && OOO_BODY_RE.test(input.body.slice(0, 600))) {
    return {
      isAutomated: true,
      suppressAutoAck: true,
      reason: "ooo-body",
    };
  }

  // 8. Exchange X-Auto-Response-Suppress: suppress auto-ack without blocking human reopens
  for (const val of headerValues(input.headers, "x-auto-response-suppress")) {
    if (/\b(?:all|oof|autoreply)\b/i.test(val)) {
      return {
        isAutomated: false,
        suppressAutoAck: true,
        reason: "x-auto-response-suppress",
      };
    }
  }

  return { isAutomated: false, suppressAutoAck: false, reason: null };
}
