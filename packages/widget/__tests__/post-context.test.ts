import { expect, it } from "vite-plus/test";
import { browserLabel, postMetadata } from "../src/adapter/post-context.js";

it.each([
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Chrome 131 on macOS",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Edge 131 on Windows",
  ],
  [
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Firefox 133 on Linux",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Safari 18 on iOS",
  ],
  ["curl/8.0", "Unknown browser"],
])("names the browser of %s", (userAgent, label) => {
  expect(browserLabel(userAgent)).toBe(label);
});

it("keeps the host keys within the API bound and sets the browser itself", () => {
  const host = Object.fromEntries(
    Array.from({ length: 25 }, (_, i) => [`k${i}`, "v"]),
  );
  const metadata = postMetadata(
    { ...host, browser: "spoofed" },
    "Firefox/133.0 (X11; Linux x86_64)",
  );
  expect(Object.keys(metadata)).toHaveLength(20);
  expect(metadata.browser).toBe("Firefox 133 on Linux");
});
