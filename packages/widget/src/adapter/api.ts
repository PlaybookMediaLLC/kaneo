/** A failed widget API call. Status 0 means the request did not reach the API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface WidgetUserView {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

function hasLeadingZeroBits(bytes: Uint8Array, bits: number): boolean {
  let remaining = bits;
  for (const byte of bytes) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
    } else {
      const mask = 0xff << (8 - remaining);
      return (byte & mask) === 0;
    }
  }
  return true;
}

async function solvePow(
  token: string,
  difficulty: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (
    !subtle ||
    signal?.aborted ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 24
  ) {
    return null;
  }
  const enc = new TextEncoder();
  for (let nonce = 0; nonce < 2_000_000; nonce++) {
    if (signal?.aborted) return null;
    const hash = new Uint8Array(
      await subtle.digest("SHA-256", enc.encode(`${token}:${nonce}`)),
    );
    if (hasLeadingZeroBits(hash, difficulty)) return String(nonce);
  }
  return null;
}

/**
 * A client for /api/quills-public/{workspace}. It holds the widget session Bearer token in
 * memory only: never in storage, URLs or logs (RFC 0001).
 */
export function createApi(
  base: string,
  fetchImpl: typeof fetch = fetch,
  options?: { widgetProxied?: boolean },
) {
  let token: string | null = null;
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    /** A Bearer for this request only, in place of the session token. */
    bearer?: string,
    extraHeaders?: Record<string, string>,
    isChallengeRetry = false,
  ): Promise<T> {
    const auth = bearer ?? token;
    const normalizedPath =
      options?.widgetProxied && path.startsWith("/widget/")
        ? path.slice("/widget".length)
        : path;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${normalizedPath}`, {
        method,
        signal,
        // The widget authenticates with its Bearer token only, never with Kaneo cookies.
        credentials: "omit",
        headers: {
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(auth && { authorization: `Bearer ${auth}` }),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(
        0,
        "The service is unreachable. Check your connection.",
      );
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const errObj = data as {
        code?: unknown;
        provider?: unknown;
        message?: unknown;
      } | null;
      // Transparently solve stateless PoW challenges when adaptive/always protection triggers (#320).
      if (
        res.status === 403 &&
        !isChallengeRetry &&
        path !== "/widget/challenge" &&
        errObj?.code === "CHALLENGE_REQUIRED" &&
        errObj?.provider === "pow"
      ) {
        const challenge = await request<{
          provider: string;
          token: string | null;
          difficulty: number | null;
        }>(
          "POST",
          "/widget/challenge",
          undefined,
          signal,
          undefined,
          undefined,
          true,
        ).catch(() => null);
        if (
          challenge?.provider === "pow" &&
          challenge.token &&
          challenge.difficulty
        ) {
          const nonce = await solvePow(
            challenge.token,
            challenge.difficulty,
            signal,
          );
          if (nonce !== null) {
            return request<T>(
              method,
              path,
              body,
              signal,
              bearer,
              {
                ...extraHeaders,
                "x-quills-challenge-provider": "pow",
                "x-quills-challenge-token": challenge.token,
                "x-quills-challenge-nonce": nonce,
              },
              true,
            );
          }
        }
      }
      const message = errObj?.message;
      throw new ApiError(
        res.status,
        typeof message === "string" && message ? message : "Request failed",
      );
    }
    return data as T;
  }
  return {
    request,
    hasSession: () => token !== null,
    /** The host sets the token only for the identity that is still current. */
    setToken(next: string | null) {
      token = next;
    },
    async mintAnonymous(signal?: AbortSignal) {
      const result = await request<{ sessionToken: string }>(
        "POST",
        "/widget/anonymous-session",
        undefined,
        signal,
      );
      return result.sessionToken;
    },
    /**
     * The host app's backend signs ssoToken; the widget never holds the secret. With the anonymous
     * session's token as `previousToken` (and as the Bearer), its activity moves to the person.
     */
    async identify(
      ssoToken: string,
      signal?: AbortSignal,
      previousToken?: string,
    ) {
      const result = await request<{
        sessionToken: string;
        user: WidgetUserView;
        warnings?: Array<{ code: string; field: string }>;
        canPortalHandoff?: boolean;
        portalSignIn?: boolean;
      }>(
        "POST",
        "/widget/identify",
        { ssoToken, ...(previousToken && { previousToken }) },
        signal,
        previousToken,
      );
      // How the portal opens for this person: signed in from the widget (G-17), or a mailed link.
      const portal: "sign-in" | "link" | null = result.portalSignIn
        ? "sign-in"
        : result.canPortalHandoff
          ? "link"
          : null;
      return {
        token: result.sessionToken,
        user: result.user,
        warnings: result.warnings ?? [],
        portal,
      };
    },
    /**
     * Asks Kaneo to mail its portal sign-in link to the identified visitor's email. "if_account":
     * registration is closed, so only an address with an account gets the mail.
     */
    async sendPortalLink() {
      const result = await request<{ delivery: "sent" | "if_account" }>(
        "POST",
        "/widget/portal-link",
      );
      return result.delivery;
    },
    /** Keeps visitor presence warm so offline continuation emails pause while actively chatting (#319). */
    heartbeatPresence(streamKey: string, signal?: AbortSignal) {
      return request<{ ok: boolean }>(
        "PUT",
        "/widget/presence",
        { streamKey },
        signal,
      );
    },
    /** Exchanges a signed email continuation token for a fresh widget session + conversation ID (#319). */
    resumeConversation(resumeToken: string, signal?: AbortSignal) {
      return request<{ sessionToken: string; conversationId: string }>(
        "POST",
        "/widget/resume",
        { resumeToken },
        signal,
      );
    },
  };
}
export type Api = ReturnType<typeof createApi>;
