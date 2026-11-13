import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { oauthFailureOutcome, oauthResultUrl } from "./oauth-result";

afterEach(() => vi.unstubAllEnvs());

describe("OAuth result links", () => {
  it("carries only the fixed outcome and encoded display name", () => {
    vi.stubEnv("KANEO_CLIENT_URL", "https://web.example.test/base");
    const url = new URL(oauthResultUrl("connected", "Docs & Support"));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://web.example.test/quills/oauth/result",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      outcome: "connected",
      name: "Docs & Support",
    });
  });

  it("maps expected callback failures without provider text", () => {
    expect([400, 401, 403, 404, 409, 502].map(oauthFailureOutcome)).toEqual([
      "denied",
      "unauthorized",
      "no_access",
      "not_found",
      "restart",
      "failed",
    ]);
  });
});
