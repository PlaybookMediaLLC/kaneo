import { describe, expect, it } from "vite-plus/test";
import {
  renderBrandedEmail,
  sanitizeEmailTemplateHtml,
} from "./brand-renderer";

describe("Multi-brand email renderer (#332)", () => {
  it("renders two brands distinctly and produces byte-identical preview & send HTML", () => {
    const blocks = [
      { id: "b1", type: "header" as const, content: "Hello {{customerName}}" },
      { id: "b2", type: "text" as const, content: "We received your request." },
      {
        id: "b3",
        type: "button" as const,
        label: "View conversation",
        url: "https://support.example.com/r/abc",
      },
    ];

    const brandA = renderBrandedEmail({
      brand: {
        name: "Acme Cloud",
        primaryColor: "#2563eb",
        footerText: "Acme Cloud Inc.",
        hidePoweredBy: true,
      },
      subject: "Re: {{subject}}",
      mode: "blocks",
      blocks,
      variables: { customerName: "Alice", subject: "Billing question" },
    });

    const brandAAgain = renderBrandedEmail({
      brand: {
        name: "Acme Cloud",
        primaryColor: "#2563eb",
        footerText: "Acme Cloud Inc.",
        hidePoweredBy: true,
      },
      subject: "Re: {{subject}}",
      mode: "blocks",
      blocks,
      variables: { customerName: "Alice", subject: "Billing question" },
    });

    const brandB = renderBrandedEmail({
      brand: {
        name: "Beta Studio",
        primaryColor: "#dc2626",
        footerText: "Beta Studio LLC",
        hidePoweredBy: false,
      },
      subject: "Re: {{subject}}",
      mode: "blocks",
      blocks,
      variables: { customerName: "Alice", subject: "Billing question" },
    });

    // Byte-for-byte deterministic preview === send
    expect(brandA.html).toBe(brandAAgain.html);
    expect(brandA.subject).toBe("Re: Billing question");
    expect(brandA.html).toContain("#2563eb");
    expect(brandA.html).toContain("Acme Cloud Inc.");
    expect(brandA.html).not.toContain("Powered by Kaneo");
    expect(brandA.html).toContain("prefers-color-scheme: dark");
    expect(brandA.html).toContain("<!--[if mso]>");

    // Second brand differs cleanly
    expect(brandB.html).not.toBe(brandA.html);
    expect(brandB.html).toContain("#dc2626");
    expect(brandB.html).toContain("Beta Studio LLC");
    expect(brandB.html).toContain("Powered by Kaneo");
  });

  it("sanitizes raw HTML templates against scripts, styles, SVG, nested tags, dangerous CSS, entity-encoded javascript URLs, and CRLF subject injection", () => {
    const dirty =
      '<p onclick="alert(1)" style="background:url(javascript:alert(1))">Hello</p><script>evil()</script><style>body{background:url(javascript:alert(1))}</style><svg onload="alert(2)"></svg><scr<script>ipt>bad()</script><a href="&#106;avascript:alert(2)">Click</a><a href="javascript:alert(3)">Bad</a><iframe src="https://evil.test"></iframe>';
    const clean = sanitizeEmailTemplateHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("<style");
    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("url(");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("&#106;");
    expect(clean).toContain("<p>Hello</p>");

    const rendered = renderBrandedEmail({
      brand: {
        name: "Acme",
        logoUrl: "javascript:alert(1)",
      },
      subject: "Hello {{customerName}}\r\nBcc: evil@attacker.test",
      mode: "html",
      htmlBody:
        '<p style="background:u/**/rl(https://evil.test/t)">Hi {{customerName}}</p><p style="background:\\75\\72\\6c(https://evil.test/x)">Test</p><a href="{{ctaUrl}}">Open</a>',
      variables: {
        customerName: '<img src=x onerror="alert(1)">',
        ctaUrl: "https://support.example.com/r/1?a=1&b=2",
      },
    });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
    expect(rendered.html).not.toContain("javascript:alert");
    expect(rendered.html).not.toContain('onerror="alert(1)"');
    expect(rendered.html).not.toContain("evil.test");
    expect(rendered.html).toContain("&lt;img");
    expect(rendered.html).toContain(
      'href="https://support.example.com/r/1?a=1&amp;b=2"',
    );
    expect(rendered.html).not.toContain("&amp;amp;");
  });
});
