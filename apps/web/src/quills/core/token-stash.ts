const MAX_AGE_MS = 30 * 60 * 1000;
const PREFIX = "quills-link-token:";
const memory = new Map<string, StoredToken>();

interface StoredToken {
  token: string;
  expiresAt: number;
}

function key(scope: string): string {
  return `${PREFIX}${scope}`;
}

export function stashToken(
  scope: string,
  token: string,
  persist = false,
): void {
  discardExpiredTokens();
  const value: StoredToken = { token, expiresAt: Date.now() + MAX_AGE_MS };
  memory.set(scope, value);
  if (!persist) return;
  localStorage.setItem(key(scope), JSON.stringify(value));
}

export function takeStashedToken(scope: string): string | null {
  discardExpiredTokens();
  const inMemory = memory.get(scope);
  if (inMemory) {
    memory.delete(scope);
    localStorage.removeItem(key(scope));
    return inMemory.token;
  }
  const raw = localStorage.getItem(key(scope));
  localStorage.removeItem(key(scope));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredToken;
    return value.expiresAt > Date.now() ? value.token : null;
  } catch {
    return null;
  }
}

export function clearTokenStash(): void {
  memory.clear();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const itemKey = localStorage.key(index);
    if (itemKey?.startsWith(PREFIX)) localStorage.removeItem(itemKey);
  }
}

export function removeTokenFromAddress(
  token: "query" | "fragment",
): string | null {
  const url = new URL(window.location.href);
  const value =
    token === "query"
      ? url.searchParams.get("token")
      : new URLSearchParams(url.hash.slice(1)).get("token");
  if (!value) return null;
  if (token === "query") url.searchParams.delete("token");
  else url.hash = "";
  window.history.replaceState(window.history.state, "", url);
  return value;
}

export function discardExpiredTokens(): void {
  for (const [scope, value] of memory) {
    if (value.expiresAt <= Date.now()) memory.delete(scope);
  }
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const itemKey = localStorage.key(index);
    if (!itemKey?.startsWith(PREFIX)) continue;
    try {
      const value = JSON.parse(
        localStorage.getItem(itemKey) ?? "null",
      ) as StoredToken | null;
      if (
        !value ||
        typeof value.token !== "string" ||
        !(value.expiresAt > Date.now())
      )
        localStorage.removeItem(itemKey);
    } catch {
      localStorage.removeItem(itemKey);
    }
  }
}

// Purge expired persisted links when a suspended tab resumes.
window.addEventListener("pageshow", discardExpiredTokens);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") discardExpiredTokens();
});
discardExpiredTokens();
