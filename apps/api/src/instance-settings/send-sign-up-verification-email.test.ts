import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { sendEmailVerificationEmail } from "@kaneo/email";
import { sendSignUpVerificationEmail } from "./send-sign-up-verification-email";

vi.mock("@kaneo/email", () => ({ sendEmailVerificationEmail: vi.fn() }));
const mail = vi.mocked(sendEmailVerificationEmail);
const origin = "https://web.example.test";
const returnPath = "/portal/workspace_test/invite/invite_test";

async function sentCallback(callback?: string) {
  const verification = new URL(
    "https://api.example.test/api/auth/verify-email",
  );
  verification.searchParams.set("token", "verification-test-value");
  if (callback !== undefined)
    verification.searchParams.set("callbackURL", callback);
  await sendSignUpVerificationEmail({
    user: { email: "customer@example.test", name: "Customer" },
    url: verification.href,
  });
  const props = mail.mock.calls.at(-1)![2];
  const sent = new URL(props.verificationLink);
  expect(sent.origin).toBe("https://api.example.test");
  expect(sent.searchParams.get("token")).toBe("verification-test-value");
  return sent.searchParams.get("callbackURL");
}

function callbackFor(redirect: string) {
  const callback = new URL("/auth/sign-in", origin);
  callback.searchParams.set("redirect", redirect);
  return callback.href;
}

describe("signup verification return", () => {
  beforeEach(() => {
    vi.stubEnv("KANEO_CLIENT_URL", origin);
    mail.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("keeps the portal return on the web origin for a split deployment", async () => {
    expect(await sentCallback(callbackFor(returnPath))).toBe(
      callbackFor(returnPath),
    );
  });

  it("keeps the default sign-in destination when no callback is supplied", async () => {
    expect(await sentCallback()).toBe(`${origin}/auth/sign-in`);
  });

  it("preserves the configured client base path for the default return", async () => {
    vi.stubEnv("KANEO_CLIENT_URL", `${origin}/kaneo/`);
    expect(await sentCallback()).toBe(`${origin}/kaneo/auth/sign-in`);
  });

  it.each([
    "https://foreign.example.test/auth/sign-in?redirect=/portal/workspace_test",
    `${origin}/other?redirect=/portal/workspace_test`,
    "javascript:alert(1)",
    "http://[",
  ])("rejects an untrusted callback %s", async (callback) => {
    expect(await sentCallback(callback)).toBe(`${origin}/auth/sign-in`);
  });

  it.each([
    "//foreign.example.test",
    "/\\foreign.example.test",
    "/\n/foreign.example.test",
    "/portal/workspace_test?token=private-test-value",
    "/portal/workspace_test#token=private-test-value",
    "/%2fforeign.example.test",
    "/portal/workspace_test%3ftoken=private-test-value",
  ])("discards unsafe return paths %s", async (redirect) => {
    expect(await sentCallback(callbackFor(redirect))).toBe(
      `${origin}/auth/sign-in`,
    );
  });

  it("drops unrelated callback parameters", async () => {
    expect(
      await sentCallback(`${callbackFor(returnPath)}&token=private-test-value`),
    ).toBe(callbackFor(returnPath));
  });
});
