import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  hashRequestLinkToken,
  mintRequestLinkToken,
  verifyRequestLinkToken,
} from "./request-magic-link";

describe("request-magic-link (#313)", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "unit-auth-secret-of-at-least-32-characters");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints, hashes, and verifies a single-resource token", () => {
    const now = 1_700_000_000_000;
    const minted = mintRequestLinkToken({
      workspaceId: "ws_1",
      resourceType: "conversation",
      resourceId: "conversation_abc",
      principalId: "principal_cust",
      ttlDays: 30,
      now,
    });
    expect(minted.token.startsWith("rl1.")).toBe(true);
    expect(minted.tokenHash).toBe(hashRequestLinkToken(minted.token));

    const claims = verifyRequestLinkToken(minted.token, "ws_1", now + 1000);
    expect(claims).toMatchObject({
      workspaceId: "ws_1",
      resourceType: "conversation",
      resourceId: "conversation_abc",
      principalId: "principal_cust",
    });

    // Wrong workspace rejected
    expect(verifyRequestLinkToken(minted.token, "ws_2", now + 1000)).toBeNull();
    // Expired rejected
    expect(
      verifyRequestLinkToken(minted.token, "ws_1", now + 31 * 86_400_000),
    ).toBeNull();
    // Tampered rejected
    expect(
      verifyRequestLinkToken(`${minted.token}a`, "ws_1", now + 1000),
    ).toBeNull();
  });
});
