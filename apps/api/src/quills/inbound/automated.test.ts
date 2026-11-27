import { describe, expect, it } from "vite-plus/test";
import { detectAutomatedEmail } from "./automated";

describe("detectAutomatedEmail (#311, #331)", () => {
  it("flags RFC 3834 Auto-Submitted, Precedence, X-Autoreply, and null Return-Path", () => {
    expect(
      detectAutomatedEmail({
        from: "alice@acme.example",
        headers: [{ name: "Auto-Submitted", value: "auto-replied" }],
      }).isAutomated,
    ).toBe(true);
    expect(
      detectAutomatedEmail({
        from: "alice@acme.example",
        headers: { Precedence: "bulk" },
      }).isAutomated,
    ).toBe(true);
    expect(
      detectAutomatedEmail({
        from: "alice@acme.example",
        headers: [{ name: "Return-Path", value: "<>" }],
      }).isAutomated,
    ).toBe(true);
    expect(
      detectAutomatedEmail({
        from: "alice@acme.example",
        headers: [{ name: "Auto-Submitted", value: "no" }],
      }).isAutomated,
    ).toBe(false);
  });

  it("flags OOO subjects, bounces, and no-reply senders", () => {
    expect(
      detectAutomatedEmail({
        from: "alice@acme.example",
        subject: "Automatic reply: Re: Invoice issue",
      }).isAutomated,
    ).toBe(true);
    expect(
      detectAutomatedEmail({
        from: "MAILER-DAEMON@mx.example",
        subject: "Undelivered Mail Returned to Sender",
      }).isAutomated,
    ).toBe(true);
    expect(
      detectAutomatedEmail({
        from: "noreply@service.example",
        subject: "Notification",
      }).isAutomated,
    ).toBe(true);
  });

  it("allows genuine customer replies and distinguishes Exchange suppressAutoAck from automated mail", () => {
    expect(
      detectAutomatedEmail({
        from: "Jane Customer <jane@acme.example>",
        subject: "Re: Export still failing",
        body: "Thanks, I tried again and I am still seeing the timeout error.",
      }),
    ).toEqual({ isAutomated: false, suppressAutoAck: false, reason: null });

    expect(
      detectAutomatedEmail({
        from: "Jane Customer <jane@acme.example>",
        subject: "Re: Export still failing",
        headers: [{ name: "X-Auto-Response-Suppress", value: "All" }],
        body: "Still broken for our team.",
      }),
    ).toEqual({
      isAutomated: false,
      suppressAutoAck: true,
      reason: "x-auto-response-suppress",
    });
  });
});
