// @vitest-environment happy-dom
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vite-plus/test";

// The browser-queue module runs side-effects at import time, so each test
// needs a fresh import with isolated module state.

declare global {
  interface Window {
    Quills?: ((...args: unknown[]) => unknown) & { q?: IArguments[] };
    Quackback?: ((...args: unknown[]) => unknown) & { q?: IArguments[] };
    __QUACKBACK_URL__?: string;
  }
}

function mockSDK(): unknown[][] {
  const dispatched: unknown[][] = [];
  vi.doMock("../src/core/sdk", () => ({
    createSDK: () => ({
      dispatch: (...args: unknown[]) => {
        dispatched.push(args);
      },
      isOpen: () => false,
      getUser: () => null,
      isIdentified: () => false,
    }),
  }));
  return dispatched;
}

/** Runs the bundle as if Kaneo served it at this URL (document.currentScript.src). */
function servedFrom(src: string): void {
  const script = document.createElement("script");
  script.src = src;
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

/** The inline snippet's queue stub, on `window.Quills` or the older `window.Quackback`. */
function installQueueStub(name: "Quills" | "Quackback" = "Quills"): void {
  const q: IArguments[] = [];
  const queueFn = function (this: void) {
    // oxlint-disable-next-line prefer-rest-params
    q.push(arguments);
  } as ((...args: unknown[]) => unknown) & { q: IArguments[] };
  queueFn.q = q;
  window[name] = queueFn;
}

describe("browser-queue", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as Window).Quills;
    delete (window as Window).Quackback;
    delete (window as Window).__QUACKBACK_URL__;
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    // Flush the real SDK's idle-time panel preload synchronously so the
    // end-to-end tests can assert panel DOM right after init.
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((cb: () => void) => {
        cb();
        return 1;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
  });

  afterEach(() => {
    delete (document as { currentScript?: unknown }).currentScript;
    window.Quills?.("destroy");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("replays queued commands through the SDK after the script loads", async () => {
    const dispatched = mockSDK();
    installQueueStub();
    window.Quills!("init", { instanceUrl: "https://feedback.acme.com" });
    window.Quills!("identify", { id: "u1", email: "a@b.c" });

    await import("../src/browser-queue");

    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://feedback.acme.com" },
      undefined,
    ]);
    expect(dispatched[1]).toEqual([
      "identify",
      { id: "u1", email: "a@b.c" },
      undefined,
    ]);
  });

  it("replaces window.Quills with a live dispatcher after loading", async () => {
    vi.doMock("../src/core/sdk", () => ({
      createSDK: () => ({
        dispatch: () => "DISPATCHED",
        isOpen: () => false,
        getUser: () => null,
        isIdentified: () => false,
      }),
    }));

    await import("../src/browser-queue");

    expect(typeof window.Quills).toBe("function");
    expect((window.Quills as (...args: unknown[]) => unknown)("open")).toBe(
      "DISPATCHED",
    );
    // A new install gets no global with the old name.
    expect(window.Quackback).toBeUndefined();
  });

  it("keeps a snippet pasted before the rename working on window.Quackback", async () => {
    const dispatched = mockSDK();
    installQueueStub("Quackback");
    window.Quackback!("init", { instanceUrl: "https://feedback.acme.com" });

    await import("../src/browser-queue");

    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://feedback.acme.com" },
      undefined,
    ]);
    // Later calls from that host page still reach the SDK.
    window.Quackback!("open");
    expect(dispatched[1]).toEqual(["open", undefined, undefined]);
    expect(window.Quills).toBe(window.Quackback);
  });

  it("auto-dispatches init with the baked instance URL if no init was queued", async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";

    await import("../src/browser-queue");
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://feedback.acme.com" },
      undefined,
    ]);
  });

  it("folds the baked instance URL into a queued init that omits it", async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";
    installQueueStub();
    // Script-tag installs omit instanceUrl — it's baked into the served sdk.js.
    window.Quills!("init", { launcher: false, placement: "left" });

    await import("../src/browser-queue");

    expect(dispatched[0]).toEqual([
      "init",
      {
        launcher: false,
        placement: "left",
        instanceUrl: "https://feedback.acme.com",
      },
      undefined,
    ]);
  });

  it("an explicit init dispatched after load is not pre-empted by the auto-init", async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";

    await import("../src/browser-queue");

    // Host page's config call lands after the bundle loaded (e.g. from React).
    window.Quills!("init", { launcher: false, placement: "left" });

    // Let the deferred auto-init fall through.
    await new Promise((r) => setTimeout(r, 0));

    const inits = dispatched.filter((d) => d[0] === "init");
    expect(inits).toHaveLength(1);
    expect(inits[0][1]).toEqual({
      launcher: false,
      placement: "left",
      instanceUrl: "https://feedback.acme.com",
    });
  });

  it('folds the baked instance URL into a bare queued `Quackback("init")` call', async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";
    installQueueStub();
    // The documented admin snippet — no second argument at all.
    window.Quills!("init");

    await import("../src/browser-queue");

    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://feedback.acme.com" },
      undefined,
    ]);
  });

  it("destroy before the deferred fallback suppresses it", async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";

    await import("../src/browser-queue");
    window.Quills!("destroy");
    await new Promise((r) => setTimeout(r, 0));

    // Host explicitly destroyed — the fallback must not spawn a default widget.
    const inits = dispatched.filter((d) => d[0] === "init");
    expect(inits).toHaveLength(0);
  });

  it('end-to-end: fallback first, then a host init({launcher:false, placement:"left"}) destroys + rebuilds', async () => {
    // The user's actual reported scenario: bundle loads, fallback auto-init
    // fires (default launcher on right), then app/React code's init lands
    // and must reconfigure. Exercises both halves at the seam.
    vi.doUnmock("../src/core/sdk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) })),
    );
    servedFrom(
      "https://feedback.acme.com/api/quills-public/acme/widget/sdk.js",
    );

    await import("../src/browser-queue");
    // Let the deferred fallback fire first.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.querySelector('button[aria-label="Open feedback widget"]'),
    ).not.toBeNull();

    // Host's explicit init must destroy + rebuild with the new options.
    window.Quills!("init", { launcher: false, placement: "left" });

    expect(
      document.querySelector('button[aria-label="Open feedback widget"]'),
    ).toBeNull();
    const styles =
      document.getElementById("quackback-widget-styles")?.textContent ?? "";
    expect(styles).toContain("left:16px");
    expect(styles).not.toContain("right:16px");
  });

  it('end-to-end: a post-load init({launcher:false, placement:"left"}) reconfigures the DOM', async () => {
    // doMock leaks across vi.resetModules; unmock so this test runs through
    // the real SDK and catches regressions on either side of the fix.
    vi.doUnmock("../src/core/sdk");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ theme: {} }) })),
    );
    servedFrom(
      "https://feedback.acme.com/api/quills-public/acme/widget/sdk.js",
    );

    await import("../src/browser-queue");

    window.Quills!("init", { launcher: false, placement: "left" });
    await new Promise((r) => setTimeout(r, 0));

    expect(
      document.querySelector('button[aria-label="Open feedback widget"]'),
    ).toBeNull();
    expect(document.querySelector(".quackback-panel")).not.toBeNull();
    const styles =
      document.getElementById("quackback-widget-styles")?.textContent ?? "";
    expect(styles).toContain("left:16px");
    expect(styles).not.toContain("right:16px");
  });

  it("derives the instance URL and workspace from the served sdk.js URL", async () => {
    const dispatched = mockSDK();
    servedFrom(
      "https://kaneo.acme.com/sub/api/quills-public/acme-team/widget/sdk.js?v=1",
    );
    installQueueStub();
    window.Quills!("init", { launcher: false });

    await import("../src/browser-queue");
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatched).toEqual([
      [
        "init",
        {
          launcher: false,
          instanceUrl: "https://kaneo.acme.com/sub",
          workspace: "acme-team",
        },
        undefined,
      ],
    ]);
  });

  it("an explicit workspace wins over the served one", async () => {
    const dispatched = mockSDK();
    servedFrom("https://kaneo.acme.com/api/quills-public/acme/widget/sdk.js");

    await import("../src/browser-queue");
    window.Quills!("init", { workspace: "other" });

    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://kaneo.acme.com", workspace: "other" },
      undefined,
    ]);
  });

  it("ignores a script URL that is not the served sdk.js", async () => {
    const dispatched = mockSDK();
    servedFrom(
      "https://cdn.example.com/api/quills-public/acme/widget/other.js",
    );

    await import("../src/browser-queue");
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatched).toEqual([]);
  });

  it("does not auto-init if the queue already contains an init call", async () => {
    const dispatched = mockSDK();
    window.__QUACKBACK_URL__ = "https://feedback.acme.com";
    installQueueStub();
    window.Quills!("init", { instanceUrl: "https://override.example" });

    await import("../src/browser-queue");
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual([
      "init",
      { instanceUrl: "https://override.example" },
      undefined,
    ]);
  });
  it("answers the state reads by name and as methods", async () => {
    vi.doMock("../src/core/sdk", () => ({
      createSDK: () => ({
        dispatch: () => undefined,
        isOpen: () => true,
        getUser: () => ({ id: "u1", name: "Ada", email: "a@x.test" }),
        isIdentified: () => true,
      }),
    }));
    await import("../src/browser-queue");
    const quills = window.Quills as unknown as ((
      ...args: unknown[]
    ) => unknown) & {
      isOpen: () => boolean;
    };
    expect(quills("isOpen")).toBe(true);
    expect(quills("isIdentified")).toBe(true);
    expect(quills("getUser")).toEqual({
      id: "u1",
      name: "Ada",
      email: "a@x.test",
    });
    expect(quills.isOpen()).toBe(true);
  });

  it("reads data-instance-url and data-workspace from a script tag even when currentScript is null", async () => {
    const dispatched = mockSDK();
    const script = document.createElement("script");
    script.type = "application/octet-stream";
    script.src = "https://app.example.com/support/sdk.js";
    script.dataset.instanceUrl = "https://app.example.com/";
    script.dataset.workspace = "acme";
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", {
      value: null,
      configurable: true,
    });
    try {
      await import("../src/browser-queue");
      await new Promise((r) => setTimeout(r, 0));
      expect(dispatched).toEqual([
        [
          "init",
          { instanceUrl: "https://app.example.com", workspace: "acme" },
          undefined,
        ],
      ]);
    } finally {
      script.remove();
      Object.defineProperty(document, "currentScript", {
        value: null,
        configurable: true,
      });
    }
  });

  it("derives instanceUrl from script src origin when data-workspace is set on a custom proxy path", async () => {
    const dispatched = mockSDK();
    const script = document.createElement("script");
    script.type = "application/octet-stream";
    script.src = "https://proxy.example.com/support/sdk.js";
    script.dataset.workspace = "acme";
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", {
      value: script,
      configurable: true,
    });
    try {
      await import("../src/browser-queue");
      await new Promise((r) => setTimeout(r, 0));
      expect(dispatched).toEqual([
        [
          "init",
          { instanceUrl: "https://proxy.example.com", workspace: "acme" },
          undefined,
        ],
      ]);
    } finally {
      script.remove();
      Object.defineProperty(document, "currentScript", {
        value: null,
        configurable: true,
      });
    }
  });

  it("survives a malformed relative data-instance-url and does not auto-init without a workspace", async () => {
    const dispatched = mockSDK();
    const script = document.createElement("script");
    script.type = "application/octet-stream";
    script.src = "https://app.example.com/custom/sdk.js";
    script.dataset.instanceUrl = "//[::1";
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", {
      value: script,
      configurable: true,
    });
    try {
      await import("../src/browser-queue");
      await new Promise((r) => setTimeout(r, 0));
      expect(typeof window.Quills).toBe("function");
      expect(dispatched).toEqual([]);
    } finally {
      script.remove();
      Object.defineProperty(document, "currentScript", {
        value: null,
        configurable: true,
      });
    }
  });
});
