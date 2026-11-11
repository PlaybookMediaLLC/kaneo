import { useRef, useState } from "react";
import { ApiError, type Api, type WidgetUserView } from "./api.js";
import type { ParentMessage } from "./bridge.js";
import type { WidgetUser } from "../core/protocol.js";

type Identity = Extract<ParentMessage, { type: "identify" }>["identity"];
export type IdentifyResult = {
  success: boolean;
  user: WidgetUser | null;
  error?: string;
};

/** The API refused the token (invalid, expired, blocked, taken email). 429, 5xx and network errors are transient. */
const refused = (error: unknown) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 429;
const toUser = (user: WidgetUserView): WidgetUser => ({
  id: user.id,
  name: user.name,
  email: user.email ?? "",
  avatarUrl: user.avatarUrl,
});

/**
 * The visitor's widget session. An identified visitor gets one from the host app's signed
 * ssoToken at once; an anonymous one only when the panel first opens, because every
 * anonymous session creates a person and the API allows 10 per hour per client.
 * `onAuthChange` keeps the SDK's user in step when a later identify succeeds or is refused.
 */
export function useWidgetSession(
  api: Api,
  onAuthChange: (user: WidgetUser | null) => void,
) {
  const [session, setSession] = useState<number | null>(null);
  /** Changes with every identity: the view remounts and drops the old visitor's drafts. */
  const [visitor, setVisitor] = useState(0);
  const [failed, setFailed] = useState(false);
  const epoch = useRef(0);
  const counter = useRef(0);
  const ssoToken = useRef<string | null>(null);
  const active = useRef(false);
  const starting = useRef(false);

  const reset = () => {
    const mine = ++epoch.current;
    api.setToken(null);
    starting.current = false;
    setSession(null);
    setFailed(false);
    setVisitor((value) => value + 1);
    return mine;
  };
  const begin = (mine: number, token: string) => {
    if (mine !== epoch.current) return;
    api.setToken(token);
    starting.current = false;
    setSession(++counter.current);
  };
  /** The host's signed token when it still verifies, else an anonymous session. */
  const establish = async () => {
    if (starting.current || api.hasSession()) return;
    starting.current = true;
    const mine = epoch.current;
    setFailed(false);
    try {
      if (ssoToken.current) {
        try {
          const { token, user } = await api.identify(ssoToken.current);
          if (mine === epoch.current) onAuthChange(toUser(user));
          return begin(mine, token);
        } catch (error) {
          // Only a refused token ends the identity; a transient error keeps it for a retry.
          if (!refused(error)) throw error;
          if (mine !== epoch.current) return;
          ssoToken.current = null;
          onAuthChange(null);
        }
      }
      begin(mine, await api.mintAnonymous());
    } catch {
      if (mine === epoch.current) {
        starting.current = false;
        setFailed(true);
      }
    }
  };

  return {
    session,
    visitor,
    failed,
    establish,
    /** The panel opened: from now on the visitor needs a session. */
    activate() {
      active.current = true;
      void establish();
    },
    /**
     * The API answered 401 for `ended`: remove private data, then start again for the same
     * identity. A late 401 from an earlier session, or one during an identify, changes nothing.
     */
    expire(ended: number | null) {
      if (!api.hasSession() || ended !== counter.current) return;
      reset();
      void establish();
    },
    async identify(identity: Identity): Promise<IdentifyResult> {
      const mine = reset();
      const signed =
        identity &&
        identity !== "invalid" &&
        "ssoToken" in identity &&
        typeof identity.ssoToken === "string"
          ? identity.ssoToken
          : null;
      // Kept until the API refuses it, so the panel can retry after a transient failure.
      ssoToken.current = signed;
      if (signed) {
        // Blocks an anonymous start from the panel while the signed identify runs.
        starting.current = true;
        try {
          const { token, user } = await api.identify(signed);
          if (mine !== epoch.current)
            return { success: false, user: null, error: "Superseded" };
          begin(mine, token);
          return { success: true, user: toUser(user) };
        } catch (error) {
          if (mine === epoch.current) {
            if (refused(error)) ssoToken.current = null;
            starting.current = false;
            if (active.current) void establish();
          }
          return {
            success: false,
            user: null,
            error: error instanceof Error ? error.message : "Identify failed",
          };
        }
      }
      if (active.current) void establish();
      return identity === null ||
        (identity !== "invalid" && "anonymous" in identity)
        ? { success: true, user: null }
        : {
            success: false,
            user: null,
            error: "Kaneo identifies visitors only with a signed ssoToken",
          };
    },
  };
}
