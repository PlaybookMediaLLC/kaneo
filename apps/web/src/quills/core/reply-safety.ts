export interface MentionCandidate {
  id: string;
  displayName?: string | null;
  email?: string | null;
}

export interface InternalContentCheck {
  flagged: boolean;
  reason: "mention" | "internal_phrase" | null;
  matchedMentions: string[];
}

// Matches @handle at start of string or after whitespace/opening punctuation, avoiding emails like bob@acme.com.
const MENTION_TOKEN_RE = /(?:^|[\s([{"'])(@([A-Za-z][A-Za-z0-9._-]{1,40}))/g;

const INTERNAL_PHRASE_PATTERNS: readonly RegExp[] = [
  /\binternal\s+note\b/i,
  /\bfyi\b\s*@/i,
  /\bdo\s+not\s+share\s+(?:this\s+)?with\s+(?:the\s+)?customer\b/i,
  /\bdon['’]t\s+(?:tell|share\s+with)\s+(?:the\s+)?customer\b/i,
  /\bfor\s+(?:the\s+)?team\s+only\b/i,
  /\b(?:cc|looping\s+in)\s+@/i,
];

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function candidateHandles(candidate: MentionCandidate): string[] {
  const handles = new Set<string>();
  const name = candidate.displayName?.trim();
  if (name) {
    const lower = name.toLowerCase();
    if (!/\s/.test(lower) && lower.length >= 2) handles.add(lower);
    const first = lower.split(/\s+/)[0];
    if (first && first.length >= 2) handles.add(first);
    const compact = lower.replace(/\s+/g, "");
    if (compact.length >= 2) handles.add(compact);
    const dotted = lower.replace(/\s+/g, ".");
    if (dotted.length >= 2) handles.add(dotted);
  }
  const emailLocal = candidate.email?.split("@")[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 2) handles.add(emailLocal);
  return [...handles];
}

/**
 * Checks whether a draft typed in public reply mode looks like an internal teammate note
 * (contains an @mention or internal-only phrase), so the UI can warn before sending (#324).
 */
export function detectInternalContentInReply(
  text: string,
  _teammates: readonly MentionCandidate[] = [],
): InternalContentCheck {
  if (!text.trim()) {
    return { flagged: false, reason: null, matchedMentions: [] };
  }

  const matchedMentions: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN_RE)) {
    const raw = match[1];
    const token = match[2];
    if (!raw || !token) continue;
    const normalized = normalizeToken(token);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    // Any standalone @mention in reply mode (teammate handle or group like @here/@eng)
    // is worth prompting on, while email addresses (foo@bar.com) never match MENTION_TOKEN_RE.
    if (normalized.length >= 2) {
      matchedMentions.push(raw);
    }
  }

  if (matchedMentions.length > 0) {
    return { flagged: true, reason: "mention", matchedMentions };
  }

  for (const pattern of INTERNAL_PHRASE_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: "internal_phrase", matchedMentions: [] };
    }
  }

  return { flagged: false, reason: null, matchedMentions: [] };
}

/**
 * Resolves @mentions in note text to unique workspace teammate principal IDs (max 20)
 * so conversation/ticket notes record real mention notifications (#324).
 */
export function extractMentionedPrincipalIds(
  text: string,
  teammates: readonly MentionCandidate[],
): string[] {
  if (!text.trim() || !teammates.length) return [];
  const byHandle = new Map<string, string>();
  for (const teammate of teammates) {
    for (const handle of candidateHandles(teammate)) {
      if (!byHandle.has(handle)) byHandle.set(handle, teammate.id);
    }
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN_RE)) {
    const token = match[2];
    if (!token) continue;
    const principalId = byHandle.get(normalizeToken(token));
    if (principalId && !seen.has(principalId)) {
      seen.add(principalId);
      ids.push(principalId);
      if (ids.length >= 20) break;
    }
  }
  return ids;
}
