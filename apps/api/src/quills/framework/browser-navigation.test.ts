import { describe, expect, it } from "vite-plus/test";
import { prefersBrowserNavigation } from "./browser-navigation";

const request = (headers: Record<string, string>) =>
  prefersBrowserNavigation(new Headers(headers));

describe("prefersBrowserNavigation", () => {
  it("accepts a navigation mode even when the client asks for JSON", () => {
    expect(
      request({ "sec-fetch-mode": "navigate", accept: "application/json" }),
    ).toBe(true);
  });

  it("uses media quality and specificity to choose HTML only when preferred", () => {
    expect(
      request({
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }),
    ).toBe(true);
    expect(request({ accept: "application/json,text/html;q=0.9" })).toBe(false);
    expect(request({ accept: "text/html;q=0.5,application/*;q=0.8" })).toBe(
      false,
    );
    expect(request({ accept: "text/html;q=0,*/*;q=0.8" })).toBe(false);
    expect(
      request({ accept: "text/html;q=invalid,application/json;q=0.5" }),
    ).toBe(false);
  });

  it("keeps JSON for absent, wildcard, and equally preferred accept values", () => {
    expect(request({})).toBe(false);
    expect(request({ accept: "*/*" })).toBe(false);
    expect(request({ accept: "text/html,application/json" })).toBe(false);
  });
});
