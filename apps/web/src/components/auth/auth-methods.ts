import type { GetConfigResponse } from "@/fetchers/config/get-config";

export type AuthProvider = "google" | "github" | "discord" | "custom";
export type EmailMethod = "code" | "password";
export type SignInFooter =
  | "createAccount"
  | "inviteOnly"
  | "providerSignUp"
  | "anyProvider"
  | "contactAdmin";

type Config = GetConfigResponse | undefined;

export function getProviders(config: Config): AuthProvider[] {
  if (!config) return [];
  const providers: [AuthProvider, boolean][] = [
    ["google", config.hasGoogleSignIn],
    ["github", config.hasGithubSignIn],
    ["discord", config.hasDiscordSignIn],
    ["custom", config.hasCustomOAuth],
  ];
  return providers.filter(([, enabled]) => enabled).map(([id]) => id);
}

export function getEmailMethod(config: Config): EmailMethod | null {
  if (!config || config.disableLoginForm) return null;
  return config.hasSmtp && !config.disableEmailOtpSignIn ? "code" : "password";
}

export function getSignUpEmailMethod(
  config: Config,
  isInstanceAdminSetup: boolean,
): EmailMethod | null {
  if (isInstanceAdminSetup) return "password";
  if (config?.disablePasswordRegistration) return null;
  return getEmailMethod(config);
}

export function isSsoOnly(providers: AuthProvider[]) {
  return providers.length === 1 && providers[0] === "custom";
}

export function getSignInFooter(
  config: Config,
  emailMethod: EmailMethod | null,
  providers: AuthProvider[],
): SignInFooter {
  if (config?.disableRegistration) return "inviteOnly";
  if (!emailMethod) {
    return providers.length === 0 || isSsoOnly(providers)
      ? "contactAdmin"
      : "anyProvider";
  }
  if (config?.disablePasswordRegistration) {
    return providers.length > 0 ? "providerSignUp" : "inviteOnly";
  }
  return "createAccount";
}

export function getSafeRedirectPath(path: string | undefined) {
  if (
    !path?.startsWith("/") ||
    path.includes("//") ||
    // eslint-disable-next-line no-control-regex -- Reject controls before URL normalization.
    /[\\\u0000-\u0020]/.test(path) ||
    /%(?:2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(path)
  )
    return undefined;
  const base = "https://redirect.invalid";
  const resolved = new URL(path, base);
  return resolved.origin === base &&
    `${resolved.pathname}${resolved.search}${resolved.hash}` === path
    ? path
    : undefined;
}

export function getSignInSubtitleKey(
  emailMethod: EmailMethod | null,
  providers: AuthProvider[],
) {
  if (emailMethod === "code") {
    return providers.length > 0
      ? "auth:signIn.subtitle.emailOrProvider"
      : "auth:signIn.subtitle.email";
  }
  if (emailMethod === "password") {
    return providers.length > 0
      ? "auth:signIn.subtitle.passwordOrProvider"
      : "auth:signIn.subtitle.password";
  }
  return isSsoOnly(providers)
    ? "auth:signIn.subtitle.sso"
    : "auth:signIn.subtitle.providers";
}
