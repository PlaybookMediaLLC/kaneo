import { describe, expect, it } from "vite-plus/test";
import { bridgePage, bridgeScripts, usedPage } from "./oauth-bridge";

// Runs the page scripts with stub browser objects: what the browser removes and what it posts where.

const path = "/api/quills-public/signed/oauth/trello/bridge";
async function run(
  script: string,
  hash: string,
  answer: () => Promise<{ ok: boolean }> = async () => ({ ok: true }),
) {
  const steps: unknown[][] = [];
  const status = { textContent: "" };
  const location = { hash, pathname: path, search: "?state=s.t" };
  const history = {
    replaceState: (...args: unknown[]) => {
      steps.push(["replaceState", ...args]);
      location.hash = "";
    },
  };
  const fetch = (url: string, init: unknown) => {
    // The fragment is gone before the token leaves the page.
    steps.push(["fetch", url, init, location.hash]);
    return answer();
  };
  const document = { getElementById: (id: string) => ({ status })[id] };
  new Function("location", "history", "fetch", "document", script)(
    location,
    history,
    fetch,
    document,
  );
  await new Promise((resolve) => setTimeout(resolve));
  return { steps, status: status.textContent };
}

describe("OAuth bridge page scripts", () => {
  const [post, clear] = bridgeScripts as [string, string];

  it("removes the fragment, then posts the token with the state to the callback next to the page", async () => {
    const { steps, status } = await run(post, "#token=abc123");
    expect(steps).toEqual([
      ["replaceState", null, "", `${path}?state=s.t`],
      [
        "fetch",
        "callback?state=s.t",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "abc123" }),
        },
        "",
      ],
    ]);
    expect(status).toMatch(/^Connected\./);
    // The relative URL resolves next to the bridge page.
    expect(
      new URL("callback?state=s.t", `https://api.test${path}`).pathname,
    ).toBe("/api/quills-public/signed/oauth/trello/callback");
  });

  it("posts nothing without a token, and says so", async () => {
    for (const hash of ["", "#error=denied"]) {
      const { steps, status } = await run(post, hash);
      expect(steps).toEqual([["replaceState", null, "", `${path}?state=s.t`]]);
      expect(status).toMatch(/did not give access/);
    }
  });

  it("shows a fixed failure when the callback refuses or does not answer", async () => {
    for (const answer of [
      async () => ({ ok: false }),
      () => Promise.reject(new TypeError("offline")),
    ])
      expect((await run(post, "#token=abc123", answer)).status).toMatch(
        /^The connection failed\./,
      );
  });

  it("only removes the fragment on a second visit", async () => {
    expect((await run(clear, "#token=abc123")).steps).toEqual([
      ["replaceState", null, "", `${path}?state=s.t`],
    ]);
  });

  it("puts each declared script in its page, and no other script", () => {
    const scripts = (page: string) =>
      [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts(bridgePage)).toEqual([post]);
    expect(scripts(usedPage)).toEqual([clear]);
    expect(bridgePage.match(/<script/g)).toHaveLength(1);
  });
});
