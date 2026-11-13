import { sendEmailVerificationEmail } from "@kaneo/email";
import { accountEmailSubject } from "../admin/users/account-email-subjects";

type Recipient = { email: string; name?: string | null; locale?: unknown };

function signInUrl(callback: string | null) {
  const base = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  const destination = new URL(`${base.replace(/\/$/, "")}/auth/sign-in`);
  if (!callback) return destination.href;
  try {
    const candidate = new URL(callback, base);
    const redirect = candidate.searchParams.get("redirect");
    if (
      candidate.origin === destination.origin &&
      candidate.pathname === destination.pathname &&
      redirect?.startsWith("/") &&
      !/[\\?#]/.test(redirect) &&
      !redirect.includes("//") &&
      new URL(redirect, base).origin === destination.origin &&
      new URL(redirect, base).pathname === redirect &&
      !/%(?:2f|5c|3f|23)/i.test(redirect)
    )
      destination.searchParams.set("redirect", redirect);
  } catch {
    // An invalid callback falls back to the configured web sign-in page.
  }
  return destination.href;
}

/**
 * Email the link better-auth built for a password sign-up. After confirming,
 * the person lands on the web sign-in page instead of the API's root.
 */
export async function sendSignUpVerificationEmail({
  user,
  url,
}: {
  user: Recipient;
  url: string;
}) {
  const link = new URL(url);
  link.searchParams.set(
    "callbackURL",
    signInUrl(link.searchParams.get("callbackURL")),
  );
  const locale = typeof user.locale === "string" ? user.locale : null;
  try {
    await sendEmailVerificationEmail(
      user.email,
      (name) => accountEmailSubject("verification", locale, name),
      {
        verificationLink: link.toString(),
        userName: user.name ?? undefined,
        locale,
        requestedBy: "sign-up",
      },
    );
  } catch {
    // The account stays; signing in with the password sends a new link.
    console.error("Sign-up verification email could not be sent");
  }
}
