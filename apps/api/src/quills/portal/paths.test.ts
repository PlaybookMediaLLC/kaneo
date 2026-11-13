import { afterEach, describe, expect, it } from "vite-plus/test";
import { portalPathPatterns, portalPaths } from "./paths";

const previousClientUrl = process.env.KANEO_CLIENT_URL;

afterEach(() => {
  process.env.KANEO_CLIENT_URL = previousClientUrl;
});

describe("portal paths", () => {
  it("encodes path, query and fragment values", () => {
    process.env.KANEO_CLIENT_URL = "https://client.example.test/";
    expect(portalPaths.post("workspace/a", "post/b")).toBe(
      "https://client.example.test/portal/workspace%2Fa/posts/post%2Fb",
    );
    expect(portalPaths.invite("w", "i", "token value")).toBe(
      "https://client.example.test/portal/w/invite/i#token=token+value",
    );
    expect(portalPaths.csat("w", "token&value", 5)).toBe(
      "https://client.example.test/portal/w/csat?token=token%26value&rating=5",
    );
  });

  it("registers the teammate link as pending issue 132", () => {
    expect(
      portalPathPatterns.find(({ id }) => id === "teammateConversation"),
    ).toMatchObject({ pending: 132 });
  });
});
