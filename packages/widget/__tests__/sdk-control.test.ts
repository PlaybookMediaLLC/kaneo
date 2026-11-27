// @vitest-environment happy-dom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { createSDK } from "../src/core/sdk";

vi.mock("../src/core/capture", () => ({ capturePage: vi.fn() }));

const ORIGIN = "https://feedback.acme.com";
const init = {
  instanceUrl: ORIGIN,
  workspace: "acme",
  preload: "idle" as const,
};
let sdk: ReturnType<typeof createSDK> | undefined;

function stubIframe() {
  const postMessage = vi.fn();
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(
    {
      postMessage,
    } as unknown as Window,
  );
  return postMessage;
}
function fromIframe(data: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: ORIGIN,
      source:
        document.querySelector<HTMLIFrameElement>("iframe")?.contentWindow,
      data,
    }),
  );
}

describe("sdk control surface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) })),
    );
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => (cb(), 1));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });
  afterEach(() => {
    sdk?.dispatch("destroy");
    sdk = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("toggles the panel and reports each change in getState and statechange", () => {
    stubIframe();
    sdk = createSDK();
    const states: unknown[] = [];
    sdk.dispatch("on", "statechange", (state: unknown) => states.push(state));
    sdk.dispatch("init", { ...init, theme: "dark" });
    expect(sdk.getState()).toMatchObject({
      initialized: true,
      open: false,
      theme: "dark",
    });
    sdk.dispatch("toggle");
    expect(sdk.getState().open).toBe(true);
    sdk.dispatch("toggle");
    expect(sdk.getState().open).toBe(false);
    fromIframe({ type: "quackback:unread", count: 2 });
    expect(sdk.getState().unreadCount).toBe(2);
    expect(states.map((state) => (state as { open: boolean }).open)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("resolves identify with the iframe's result and settles a superseded one", async () => {
    stubIframe();
    sdk = createSDK();
    sdk.dispatch("init", init);
    fromIframe({ type: "quackback:ready" });
    // The anonymous identity from init is in flight.
    const first = sdk.dispatch("identify", {
      ssoToken: "a",
    }) as Promise<unknown>;
    const second = sdk.dispatch("identify", {
      ssoToken: "b",
    }) as Promise<unknown>;
    await expect(first).resolves.toEqual({
      success: false,
      user: null,
      error: "Superseded",
    });
    fromIframe({
      type: "quackback:identify-result",
      success: true,
      user: null,
    });
    const user = {
      id: "u1",
      name: "Ada",
      email: "ada@x.test",
      avatarUrl: null,
    };
    const warnings = [{ code: "ATTRIBUTE_IGNORED", field: "seats" }];
    fromIframe({
      type: "quackback:identify-result",
      success: true,
      user,
      warnings,
    });
    await expect(second).resolves.toEqual({ success: true, user, warnings });
    expect(sdk.getState()).toMatchObject({ identified: true, user });
  });

  it("reports a refused identity, an open before init and a bad theme as errors", async () => {
    stubIframe();
    sdk = createSDK();
    const errors: string[] = [];
    sdk.dispatch("on", "error", (error: { code: string }) =>
      errors.push(error.code),
    );
    sdk.dispatch("open");
    sdk.dispatch("init", init);
    fromIframe({ type: "quackback:ready" });
    fromIframe({
      type: "quackback:identify-result",
      success: true,
      user: null,
    });
    const refused = sdk.dispatch("identify", {
      ssoToken: "x",
    }) as Promise<unknown>;
    fromIframe({
      type: "quackback:identify-result",
      success: false,
      error: "Invalid or expired ssoToken",
    });
    await expect(refused).resolves.toMatchObject({
      success: false,
      error: "Invalid or expired ssoToken",
    });
    sdk.dispatch("setTheme", "neon");
    expect(errors).toEqual(["NOT_READY", "IDENTIFY_FAILED", "INVALID_OPTIONS"]);
  });

  it("sends theme and locale changes to the iframe", () => {
    const postMessage = stubIframe();
    sdk = createSDK();
    sdk.dispatch("init", { ...init, theme: "light" });
    fromIframe({ type: "quackback:ready" });
    expect(postMessage).toHaveBeenCalledWith(
      { type: "quackback:theme", data: "light" },
      ORIGIN,
    );
    sdk.dispatch("setTheme", "dark");
    sdk.dispatch("setLocale", "fr");
    expect(postMessage).toHaveBeenCalledWith(
      { type: "quackback:theme", data: "dark" },
      ORIGIN,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "quackback:locale", data: "fr" },
      ORIGIN,
    );
    expect(sdk.getState()).toMatchObject({ theme: "dark", locale: "fr" });
  });

  it("opens from the host's own element and marks it with the unread count", () => {
    stubIframe();
    document.body.innerHTML = '<button id="help">Help</button>';
    sdk = createSDK();
    sdk.dispatch("init", { ...init, launcher: { selector: "#help" } });
    expect(document.querySelector(".quackback-launcher")).toBeNull();
    document.querySelector<HTMLButtonElement>("#help")!.click();
    expect(sdk.isOpen()).toBe(true);
    fromIframe({ type: "quackback:unread", count: 3 });
    expect(
      document.querySelector("#help")!.getAttribute("data-quills-unread"),
    ).toBe("3");
    sdk.dispatch("destroy");
    expect(
      document.querySelector("#help")!.hasAttribute("data-quills-unread"),
    ).toBe(false);
  });

  it("places the default launcher at the offset", () => {
    sdk = createSDK();
    sdk.dispatch("init", { ...init, offset: { bottom: 84, side: 32 } });
    const button = document.querySelector<HTMLElement>(".quackback-launcher")!;
    expect(button.style.bottom).toBe("84px");
    expect(button.style.right).toBe("32px");
  });
  it("announces a new update beside the launcher, opens it in full mode, or only fires the event", () => {
    const postMessage = stubIframe();
    sdk = createSDK();
    const announced: unknown[] = [];
    sdk.dispatch("on", "announcement", (event: unknown) =>
      announced.push(event),
    );
    sdk.dispatch("init", init);
    fromIframe({ type: "quackback:ready" });
    fromIframe({
      type: "quackback:announce",
      entryId: "changelog_1",
      title: "Dark mode",
      open: false,
    });
    const bubble = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "New: Dark mode",
    );
    expect(bubble).toBeDefined();
    bubble!.click();
    expect(sdk.isOpen()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: "quackback:open",
        data: { view: "changelog", entryId: "changelog_1" },
      },
      ORIGIN,
    );
    sdk.dispatch("destroy");

    sdk.dispatch("init", { ...init, announcements: "full" });
    fromIframe({ type: "quackback:ready" });
    fromIframe({
      type: "quackback:announce",
      entryId: "changelog_2",
      title: "Exports",
      open: false,
    });
    expect(sdk.isOpen()).toBe(true);
    sdk.dispatch("close");
    // Once per visit.
    fromIframe({
      type: "quackback:announce",
      entryId: "changelog_2",
      title: "Exports",
      open: false,
    });
    expect(sdk.isOpen()).toBe(false);
    sdk.dispatch("destroy");

    sdk.dispatch("init", { ...init, announcements: "none" });
    fromIframe({ type: "quackback:ready" });
    fromIframe({
      type: "quackback:announce",
      entryId: "changelog_3",
      title: "Quiet",
      open: false,
    });
    expect(
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "New: Quiet",
      ),
    ).toBe(false);
    sdk.dispatch("destroy");

    // The workspace opens each new update once for each visitor.
    sdk.dispatch("init", init);
    fromIframe({ type: "quackback:ready" });
    fromIframe({
      type: "quackback:announce",
      entryId: "changelog_4",
      title: "Opened",
      open: true,
    });
    expect(sdk.isOpen()).toBe(true);
    expect(announced).toHaveLength(5);
  });
  it("renders inline in a host element, always open, without a launcher or close", () => {
    stubIframe();
    document.body.innerHTML = '<div id="feedback" style="height:600px"></div>';
    sdk = createSDK();
    sdk.dispatch("init", { ...init, container: "#feedback" });
    const panel = document.querySelector("#feedback > .quackback-panel")!;
    expect(panel.classList.contains("quackback-inline")).toBe(true);
    const src = panel.querySelector("iframe")?.getAttribute("src");
    expect(src).not.toContain("showClose");
    // The iframe page hides its own close button inline.
    expect(src).toContain("inline=1");
    expect(panel.querySelector(".quackback-panel-close")).toBeNull();
    expect(document.querySelector(".quackback-launcher")).toBeNull();
    expect(sdk.getState().open).toBe(true);
    sdk.dispatch("close");
    expect(sdk.getState().open).toBe(true);
    expect((panel as HTMLElement).inert).toBe(false);

    const errors: string[] = [];
    sdk.dispatch("on", "error", (error: { code: string }) =>
      errors.push(error.code),
    );
    sdk.dispatch("init", { ...init, container: "#missing" });
    expect(errors).toContain("CONTAINER_NOT_FOUND");
    // A bad re-init leaves the working widget in place.
    expect(document.querySelector("#feedback iframe")).not.toBeNull();
  });
});
