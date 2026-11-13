export type OAuthResultOutcome =
  | "connected"
  | "already_used"
  | "denied"
  | "unauthorized"
  | "no_access"
  | "not_found"
  | "restart"
  | "failed";

/** The only values carried from an OAuth callback to the web result page. */
export function oauthResultUrl(outcome: OAuthResultOutcome, name: string) {
  const url = new URL(
    "/quills/oauth/result",
    process.env.KANEO_CLIENT_URL || "http://localhost:5173",
  );
  url.searchParams.set("outcome", outcome);
  url.searchParams.set("name", name);
  return url.toString();
}

export function oauthFailureOutcome(status: number): OAuthResultOutcome {
  switch (status) {
    case 400:
      return "denied";
    case 401:
      return "unauthorized";
    case 403:
      return "no_access";
    case 404:
      return "not_found";
    case 409:
      return "restart";
    default:
      return "failed";
  }
}
