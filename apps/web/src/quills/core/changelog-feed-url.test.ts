import { describe, expect, it } from "vite-plus/test";
import { changelogFeedUrl } from "./changelog-feed-url";

describe("changelogFeedUrl", () => {
  it("points at the workspace feed on the API", () => {
    expect(new URL(changelogFeedUrl("workspace 1")).pathname).toMatch(
      /\/quills-public\/workspace%201\/changelog\/rss\.xml$/,
    );
  });
});
