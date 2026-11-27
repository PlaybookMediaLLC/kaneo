import { and, desc, eq, isNull } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../framework/define-route";
import { conversationParams, findConversation } from "./conversation-model";

// "Already provided" draft check (#309): prevents teammates from asking a customer to repeat
// details (email, order/invoice ID, URL, error code, browser/OS) they already shared earlier.

export type FactKind =
  | "email"
  | "order_or_invoice_id"
  | "url"
  | "error_code"
  | "browser_or_os";

export interface ProvidedFact {
  kind: FactKind;
  value: string;
  messageId: string;
  snippet: string;
}

export interface DraftWarning {
  kind: FactKind;
  message: string;
  alreadyProvidedInMessageId: string;
  snippet: string;
}

const FACT_EXTRACTORS: Array<{ kind: FactKind; pattern: RegExp }> = [
  {
    kind: "email",
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
  },
  {
    kind: "order_or_invoice_id",
    pattern:
      /\b(?:ord|order|inv|invoice|sub|acct|account)(?:[-_#\s]+#?|(?=\d))(?=[a-z0-9-]*\d)[a-z0-9-]{3,24}\b/i,
  },
  {
    kind: "url",
    pattern: /https?:\/\/[^\s<>]{4,200}/i,
  },
  {
    kind: "error_code",
    pattern:
      /\b(?:err(?:or)?[-_\s]?\d{3,6}|http\s?[45]\d{2}|[45]\d{2}\s+(?:error|bad|forbidden|timeout|unauthorized))\b/i,
  },
  {
    kind: "browser_or_os",
    pattern:
      /\b(?:chrome|firefox|safari|edge|ios|android|macos|windows\s?\d*|ubuntu|linux)\b/i,
  },
];

const DRAFT_ASK_PATTERNS: Array<{
  kind: FactKind;
  pattern: RegExp;
  label: string;
}> = [
  {
    kind: "email",
    pattern:
      /\b(?:what(?:'s| is)\s+your\s+email|share\s+your\s+email|provide\s+your\s+email|which\s+email)\b/i,
    label: "email address",
  },
  {
    kind: "order_or_invoice_id",
    pattern:
      /\b(?:order\s*(?:id|number|#)|invoice\s*(?:id|number|#)|account\s*(?:id|number))\b/i,
    label: "order/invoice/account ID",
  },
  {
    kind: "url",
    pattern:
      /\b(?:which\s+(?:url|page|link)|share\s+the\s+(?:url|link)|send\s+the\s+(?:url|link))\b/i,
    label: "page URL",
  },
  {
    kind: "error_code",
    pattern: /\b(?:what\s+error|which\s+error|error\s+(?:code|message))\b/i,
    label: "error code",
  },
  {
    kind: "browser_or_os",
    pattern:
      /\b(?:which\s+browser|what\s+browser|which\s+(?:os|operating\s+system|device))\b/i,
    label: "browser or OS",
  },
];

/** Extracts concrete facts already shared by the customer in a list of visitor messages. */
export function extractProvidedFacts(
  messages: ReadonlyArray<{ id: string; content: string }>,
): ProvidedFact[] {
  const found = new Map<FactKind, ProvidedFact>();
  for (const msg of messages) {
    for (const { kind, pattern } of FACT_EXTRACTORS) {
      if (found.has(kind)) continue;
      const match = pattern.exec(msg.content);
      if (match) {
        found.set(kind, {
          kind,
          value: match[0],
          messageId: msg.id,
          snippet: msg.content.slice(0, 140),
        });
      }
    }
  }
  return [...found.values()];
}

/** Checks a teammate's draft text against already-provided facts and returns duplicate-ask warnings. */
export function checkDraftAgainstFacts(
  draft: string,
  facts: readonly ProvidedFact[],
): DraftWarning[] {
  const byKind = new Map(facts.map((f) => [f.kind, f]));
  const warnings: DraftWarning[] = [];
  for (const ask of DRAFT_ASK_PATTERNS) {
    const fact = byKind.get(ask.kind);
    if (!fact) continue;
    if (ask.pattern.test(draft)) {
      warnings.push({
        kind: ask.kind,
        message: `Customer already provided their ${ask.label} (${fact.value})`,
        alreadyProvidedInMessageId: fact.messageId,
        snippet: fact.snippet,
      });
    }
  }
  return warnings;
}

const checkDraft = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/check-draft",
  operationId: "checkQuillsConversationDraft",
  summary: "Check a teammate draft against facts the customer already provided",
  description:
    "Deterministic check (#309) that flags when a draft asks for details (email, order/invoice ID, URL, error code, browser/OS) already supplied by the visitor.",
  action: "read",
  params: conversationParams,
  body: z.object({
    draft: z.string().trim().min(1).max(10_000),
  }),
  response: z.object({
    warnings: z.array(
      z.object({
        kind: z.enum([
          "email",
          "order_or_invoice_id",
          "url",
          "error_code",
          "browser_or_os",
        ]),
        message: z.string(),
        alreadyProvidedInMessageId: z.string(),
        snippet: z.string(),
      }),
    ),
    providedFacts: z.array(
      z.object({
        kind: z.enum([
          "email",
          "order_or_invoice_id",
          "url",
          "error_code",
          "browser_or_os",
        ]),
        value: z.string(),
        messageId: z.string(),
        snippet: z.string(),
      }),
    ),
  }),
  responseDescription: "Duplicate-ask warnings and extracted customer facts",
  errors: { 404: "Conversation not found" },
  event: { none: "Read-only draft inspection writes nothing" },
  handler: async ({ db, params, body }) => {
    const conv = await findConversation(db, params.conversationId);
    const visitorMessages = await db
      .select({
        id: conversationMessages.id,
        content: conversationMessages.content,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conv.id),
          eq(conversationMessages.senderType, "visitor"),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(50);
    const providedFacts = extractProvidedFacts([...visitorMessages].reverse());
    const warnings = checkDraftAgainstFacts(body.draft, providedFacts);
    return { warnings, providedFacts };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...checkDraft,
);
