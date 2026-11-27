import { resolveFileSecret } from "./file-secret";
import { sendOutboundRequest } from "./outbound-request";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export const authCaptchaPaths = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-in/social",
  "/sign-in/oauth2",
  "/sign-in/anonymous",
  "/sign-in/magic-link",
  "/request-password-reset",
  "/email-otp/send-verification-otp",
]);

export type TurnstileVerifyOptions = {
  expectedAction?: string;
  allowedHostnames?: readonly string[];
};

// One token is redeemed at initiation, never again at the OAuth callback or
// OTP redemption. Better Auth verifies the corresponding state/code there.
export async function verifyTurnstile(
  token: unknown,
  options?: TurnstileVerifyOptions,
): Promise<TurnstileResult> {
  const secret = resolveFileSecret("TURNSTILE_SECRET_KEY");
  if (!secret) return { ok: true };
  const failure = {
    ok: false,
    reason: "Captcha verification failed.",
  } as const;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048)
    return failure;

  try {
    const expectedAction = options?.expectedAction ?? "auth";
    const defaultHost = process.env.KANEO_CLIENT_URL
      ? new URL(process.env.KANEO_CLIENT_URL).hostname
      : "";
    const allowedHosts = options?.allowedHostnames?.length
      ? options.allowedHostnames.map((h) => h.toLowerCase())
      : defaultHost
        ? [defaultHost.toLowerCase()]
        : [];
    if (
      !options?.allowedHostnames &&
      process.env.KANEO_CLOUD === "true" &&
      process.env.NODE_ENV === "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(defaultHost)
    )
      return failure;
    const data = await sendOutboundRequest(
      TURNSTILE_VERIFY_URL,
      {
        body: new URLSearchParams({ secret, response: token }),
      },
      { readJson: true },
    );
    const hostMatches = (host: string) => {
      if (allowedHosts.length === 0) return true;
      const lower = host.toLowerCase();
      return allowedHosts.some((allowed) =>
        allowed.startsWith("*.")
          ? lower.endsWith(allowed.slice(1)) &&
            lower.length > allowed.length - 1
          : lower === allowed,
      );
    };
    if (
      data &&
      typeof data === "object" &&
      "success" in data &&
      data.success === true &&
      "action" in data &&
      data.action === expectedAction &&
      "hostname" in data &&
      typeof data.hostname === "string" &&
      hostMatches(data.hostname)
    )
      return { ok: true };
  } catch {
    // Fail closed without retaining token, secret or an upstream error body.
  }
  return failure;
}
