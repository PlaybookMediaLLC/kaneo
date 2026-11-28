import { describe, expect, it } from "vite-plus/test";
import { parseForwardedEmail } from "./forward-parser";

describe("parseForwardedEmail (#325)", () => {
  it("parses Gmail forwarded email with preamble, customer, subject, and CCs", () => {
    const result = parseForwardedEmail({
      subject: "Fwd: Billing invoice mismatch",
      cc: ["ops@customer.example"],
      text: [
        "Hey support, can you handle this VIP renewal?",
        "",
        "---------- Forwarded message ---------",
        "From: Jane Customer <jane@acme.example>",
        "Date: Thu, 12 Nov 2026 at 10:00",
        "Subject: Billing invoice mismatch",
        "To: Founder <founder@ourco.example>",
        "Cc: Finance <finance@acme.example>",
        "",
        "Hi there, our invoice #421 shows 15 seats instead of 10.",
      ].join("\n"),
    });

    expect(result.isForward).toBe(true);
    expect(result.format).toBe("gmail");
    expect(result.parseFailed).toBe(false);
    expect(result.requester).toEqual({
      address: "jane@acme.example",
      name: "Jane Customer",
    });
    expect(result.preamble).toBe(
      "Hey support, can you handle this VIP renewal?",
    );
    expect(result.forwardedBody).toBe(
      "Hi there, our invoice #421 shows 15 seats instead of 10.",
    );
    expect(result.subject).toBe("Billing invoice mismatch");
    expect(result.cc.map((c) => c.address)).toEqual([
      "ops@customer.example",
      "finance@acme.example",
    ]);
  });

  it("parses Apple Mail forwarded email", () => {
    const result = parseForwardedEmail({
      subject: "Fwd: SSO setup error",
      text: [
        "Looping in support.",
        "",
        "Begin forwarded message:",
        "",
        'From: "Alex Rivera" <alex@beta.example>',
        "Subject: SSO setup error",
        "Date: November 12, 2026 at 11:20:00 AM PST",
        "To: sales@ourco.example",
        "",
        "SAML callback returns 403.",
      ].join("\n"),
    });

    expect(result.isForward).toBe(true);
    expect(result.format).toBe("apple_mail");
    expect(result.parseFailed).toBe(false);
    expect(result.requester?.address).toBe("alex@beta.example");
    expect(result.preamble).toBe("Looping in support.");
    expect(result.forwardedBody).toBe("SAML callback returns 403.");
  });

  it("parses Outlook forwarded email and flags parseFailed when Outlook strips the email address", () => {
    const withEmail = parseForwardedEmail({
      subject: "FW: Export timeout",
      text: [
        "Please take a look.",
        "________________________________",
        "From: Dana Smith <dana@corp.example>",
        "Sent: Thursday, November 12, 2026 2:15 PM",
        "To: account-exec@ourco.example",
        "Subject: Export timeout",
        "",
        "CSV export times out over 10k rows.",
      ].join("\n"),
    });
    expect(withEmail.isForward).toBe(true);
    expect(withEmail.format).toBe("outlook");
    expect(withEmail.parseFailed).toBe(false);
    expect(withEmail.requester?.address).toBe("dana@corp.example");

    const stripped = parseForwardedEmail({
      subject: "FW: Export timeout",
      text: [
        "Please take a look.",
        "________________________________",
        "From: Dana Smith",
        "Sent: Thursday, November 12, 2026 2:15 PM",
        "To: Account Exec",
        "Subject: Export timeout",
        "",
        "CSV export times out over 10k rows.",
      ].join("\n"),
    });
    expect(stripped.isForward).toBe(true);
    expect(stripped.format).toBe("outlook");
    expect(stripped.requester).toBeNull();
    expect(stripped.parseFailed).toBe(true);
  });

  it("supports explicit #requester directive even when email headers are stripped", () => {
    const result = parseForwardedEmail({
      subject: "FW: Contract question",
      text: [
        "#requester Dana Smith <dana@corp.example>",
        "FYI she is on Enterprise plan.",
        "-----Original Message-----",
        "From: Dana Smith",
        "Sent: Thursday, November 12, 2026 2:15 PM",
        "Subject: Contract question",
        "",
        "Can we add a DPA addendum?",
      ].join("\n"),
    });

    expect(result.isForward).toBe(true);
    expect(result.format).toBe("directive");
    expect(result.parseFailed).toBe(false);
    expect(result.requester).toEqual({
      address: "dana@corp.example",
      name: "Dana Smith",
    });
    expect(result.preamble).toBe("FYI she is on Enterprise plan.");
    expect(result.forwardedBody).toBe("Can we add a DPA addendum?");
  });

  it("parses attached message/rfc822 text", () => {
    const result = parseForwardedEmail({
      subject: "Fwd: Bug report",
      text: "Check attached email from customer.",
      rfc822Text: [
        "From: Sam Lee <sam@widgets.example>",
        "Date: Thu, 12 Nov 2026 10:00:00 +0000",
        "Subject: Bug report",
        "",
        "The save button hangs.",
      ].join("\n"),
    });

    expect(result.isForward).toBe(true);
    expect(result.format).toBe("rfc822");
    expect(result.requester?.address).toBe("sam@widgets.example");
    expect(result.preamble).toBe("Check attached email from customer.");
    expect(result.forwardedBody).toBe("The save button hangs.");
  });
});
