export interface ComposerDraft {
  title: string;
  content: string;
}

const empty: ComposerDraft = { title: "", content: "" };

/** The saved draft for a key. Blocked or broken storage reads as no draft. */
export function readDraft(key: string | undefined): ComposerDraft {
  if (!key) return empty;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof value?.title === "string" && typeof value?.content === "string")
      return { title: value.title, content: value.content };
  } catch {
    // Storage can be blocked in private windows and embeds.
  }
  return empty;
}

/**
 * The draft to start from. A given title, such as a search that found nothing, starts a
 * new post: it does not take the details of an older draft, which stays saved until typing.
 */
export function startingDraft(key: string | undefined, title?: string) {
  return title ? { title, content: "" } : readDraft(key);
}

/** Saves a draft on this device; an empty draft removes the saved one. */
export function saveDraft(key: string | undefined, draft: ComposerDraft) {
  if (!key) return;
  try {
    if (draft.title.trim() || draft.content.trim())
      localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // A draft is a convenience; the form still works without storage.
  }
}
