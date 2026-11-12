import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveEmailProvider } from "@kaneo/email/quills/provider";
import { outboundProvider } from "./support-settings";

const NAMES = [
  "EMAIL_SES_ACCESS_KEY_ID",
  "EMAIL_SES_SECRET_ACCESS_KEY",
  "EMAIL_SMTP_HOST",
  "EMAIL_RESEND_API_KEY",
  "RESEND_API_KEY",
  "EMAIL_INBOUND_PROVIDER",
] as const;

/** Every subset of the provider variables, with blank values as the env templates leave them. */
const environments = Array.from({ length: 2 ** NAMES.length }, (_, mask) =>
  Object.fromEntries(
    NAMES.map((name, bit) => [
      name,
      mask & (1 << bit)
        ? name === "EMAIL_INBOUND_PROVIDER"
          ? " Resend "
          : "set"
        : bit % 2
          ? " "
          : undefined,
    ]),
  ),
);

describe("outboundProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names the provider that the mail package resolves, and null where it refuses", () => {
    for (const env of environments) {
      for (const name of NAMES) vi.stubEnv(name, env[name] ?? "");
      let expected: string | null;
      try {
        expected = resolveEmailProvider(env);
      } catch {
        expected = null;
      }
      expect([env, outboundProvider()]).toEqual([env, expected]);
    }
  });
});
