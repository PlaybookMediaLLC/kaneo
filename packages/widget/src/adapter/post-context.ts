import { METADATA_KEYS } from "./bridge.js";

/** A short browser name and platform, such as "Chrome 131 on macOS", from a user agent. */
export function browserLabel(userAgent: string): string {
  const browser =
    [
      ["Edge", /Edg\/(\d+)/],
      ["Opera", /OPR\/(\d+)/],
      ["Firefox", /Firefox\/(\d+)/],
      ["Chrome", /Chrome\/(\d+)/],
      ["Safari", /Version\/(\d+)[\d.]* .*Safari\//],
    ]
      .map(([name, pattern]) => {
        const match = (pattern as RegExp).exec(userAgent);
        return match ? `${name as string} ${match[1]}` : null;
      })
      .find(Boolean) ?? "Unknown browser";
  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return platform ? `${browser} on ${platform}` : browser;
}

/**
 * The metadata of a new feedback post: the host app's keys and the page URL from the SDK, and
 * the browser. The widget sets `browser`; the API bound of 20 keys always holds.
 */
export function postMetadata(
  host: Record<string, string>,
  userAgent: string,
): Record<string, string> {
  const { browser: _, ...rest } = host;
  return {
    ...Object.fromEntries(Object.entries(rest).slice(0, METADATA_KEYS - 1)),
    browser: browserLabel(userAgent),
  };
}
