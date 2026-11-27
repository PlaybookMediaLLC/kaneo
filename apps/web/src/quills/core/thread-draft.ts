export type ThreadDraftKind = "conversation" | "ticket";
export type ThreadComposerMode = "reply" | "note";

export interface ThreadDraft {
  text: string;
  mode: ThreadComposerMode;
}

const keyOf = (
  workspaceId: string,
  kind: ThreadDraftKind,
  threadId: string,
  userId?: string,
) =>
  `quills:thread-draft:${userId || "anon"}:${workspaceId}:${kind}:${threadId}`;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readThreadDraft(
  workspaceId: string,
  kind: ThreadDraftKind,
  threadId: string,
  userId?: string,
): ThreadDraft | null {
  if (!workspaceId || !threadId) return null;
  try {
    const raw = storage()?.getItem(keyOf(workspaceId, kind, threadId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThreadDraft>;
    if (
      typeof parsed.text !== "string" ||
      (parsed.mode !== "reply" && parsed.mode !== "note")
    ) {
      return null;
    }
    return { text: parsed.text, mode: parsed.mode };
  } catch {
    return null;
  }
}

export function writeThreadDraft(
  workspaceId: string,
  kind: ThreadDraftKind,
  threadId: string,
  draft: ThreadDraft,
  userId?: string,
): void {
  if (!workspaceId || !threadId) return;
  try {
    const store = storage();
    if (!store) return;
    if (!draft.text) {
      store.removeItem(keyOf(workspaceId, kind, threadId, userId));
      return;
    }
    store.setItem(
      keyOf(workspaceId, kind, threadId, userId),
      JSON.stringify(draft),
    );
  } catch {
    // Private browsing or quota full: keep the draft in memory only.
  }
}

export function clearThreadDraft(
  workspaceId: string,
  kind: ThreadDraftKind,
  threadId: string,
  userId?: string,
): void {
  if (!workspaceId || !threadId) return;
  try {
    storage()?.removeItem(keyOf(workspaceId, kind, threadId, userId));
  } catch {
    // Ignore storage access errors.
  }
}
