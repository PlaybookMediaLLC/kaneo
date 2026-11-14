import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WidgetHost } from "../src/adapter/WidgetHost";

const HOST = "https://host.test";
const parent = { postMessage: vi.fn() };
let table: Record<
  string,
  (init: RequestInit) => { status?: number; body: unknown }
>;
let calls: Array<{ key: string; init: RequestInit }>;

const post = {
  id: "p1",
  title: "Dark mode",
  content: "Please",
  board: { id: "b1", name: "Ideas", slug: "ideas" },
  status: { id: "s1" },
  stage: "open",
  author: { name: "Al", avatarUrl: null },
  voteCount: 3,
  voted: false,
  following: false,
  createdAt: "2026-11-01T00:00:00.000Z",
};
const user = {
  id: "u1",
  name: "Ada",
  email: "ada@example.test",
  avatarUrl: null,
};

function fromParent(data: unknown, origin = HOST) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin, source: parent as never }),
    );
  });
}
const posted = (type: string) =>
  parent.postMessage.mock.calls.filter(([message]) => message.type === type);
const requested = (key: string) => calls.filter((call) => call.key === key);

beforeEach(() => {
  parent.postMessage.mockReset();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
  calls = [];
  table = {
    "GET /widget/config.json": () => ({
      body: {
        enabled: true,
        config: {
          tabs: {
            feedback: true,
            changelog: false,
            help: false,
            messenger: false,
          },
          theme: { themeMode: "user" },
        },
      },
    }),
    "GET /widget/capabilities": () => ({
      body: { chat: { pollIntervalMs: 10000 } },
    }),
    "POST /widget/anonymous-session": () => ({
      body: { sessionToken: "anon" },
    }),
    "POST /widget/identify": () => ({ body: { sessionToken: "known", user } }),
    "GET /widget/posts?limit=50": () => ({ body: { items: [post] } }),
    "GET /widget/posts/p1": () => ({ body: post }),
    "GET /widget/posts/p1/comments?limit=100": () => ({ body: { items: [] } }),
    "PUT /widget/posts/p1/vote": () => ({
      body: { postId: "p1", voted: true, voteCount: 4, changed: true },
    }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const key = `${init.method} ${url.replace("/api/quills-public/acme", "")}`;
      calls.push({ key, init });
      const reply = table[key]?.(init) ?? {
        status: 404,
        body: { message: "Not found" },
      };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { parent?: unknown }).parent;
});

const mount = () =>
  render(
    <div style={{ height: 760 }}>
      <WidgetHost
        base="/api/quills-public/acme"
        params={new URLSearchParams()}
      />
    </div>,
  );

describe("widget host page", () => {
  it("starts an anonymous session only when the panel opens, then loads and votes through the API", async () => {
    mount();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "quackback:ready" },
      "*",
    );
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "quackback:identify-result", success: true, user: null },
        HOST,
      ),
    );
    expect(requested("POST /widget/anonymous-session")).toHaveLength(0);

    fromParent({ type: "quackback:open", data: { postId: "p1" } });
    await screen.findByRole("button", { name: "Vote · 3" });
    expect(requested("POST /widget/anonymous-session")).toHaveLength(1);
    expect(requested("GET /widget/posts/p1/comments?limit=100")).toHaveLength(
      1,
    );
    expect(
      requested("GET /widget/posts?limit=50")[0]!.init.headers,
    ).toMatchObject({
      authorization: "Bearer anon",
    });

    fireEvent.click(screen.getByRole("button", { name: "Vote · 3" }));
    await screen.findByRole("button", { name: "Voted · 4" });
    expect(requested("PUT /widget/posts/p1/vote")[0]!.init.body).toBe(
      '{"voted":true}',
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: "quackback:event",
        name: "vote",
        payload: { postId: "p1", voted: true, voteCount: 4 },
      },
      HOST,
    );
  });

  it("identifies with the host's signed token and starts again for that identity after a 401", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        {
          type: "quackback:identify-result",
          success: true,
          user: { ...user, avatarUrl: null },
        },
        HOST,
      ),
    );
    let expired = true;
    table["GET /widget/posts?limit=50"] = () =>
      expired
        ? ((expired = false),
          { status: 401, body: { message: "Valid widget session required" } })
        : { body: { items: [post] } };
    fromParent({ type: "quackback:open", data: {} });
    await waitFor(() =>
      expect(requested("GET /widget/posts?limit=50")).toHaveLength(2),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Feedback" }));
    await screen.findByText("Dark mode");
    expect(requested("POST /widget/identify")).toHaveLength(2);
    expect(
      requested("GET /widget/posts?limit=50")[1]!.init.headers,
    ).toMatchObject({
      authorization: "Bearer known",
    });
    expect(requested("POST /widget/anonymous-session")).toHaveLength(0);
    // The new session is for the same person; the SDK hears it, never a sign-out.
    expect(posted("quackback:auth-change").map(([message]) => message)).toEqual(
      [{ type: "quackback:auth-change", user: { ...user, avatarUrl: null } }],
    );
  });

  it("keeps the identity after a transient identify failure and retries it when the panel opens", async () => {
    let down = true;
    table["POST /widget/identify"] = () =>
      down
        ? { status: 503, body: { message: "Service Unavailable" } }
        : { body: { sessionToken: "known", user } };
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        {
          type: "quackback:identify-result",
          success: false,
          user: null,
          error: "Service Unavailable",
        },
        HOST,
      ),
    );
    down = false;
    fromParent({ type: "quackback:open", data: {} });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "quackback:auth-change", user: { ...user, avatarUrl: null } },
        HOST,
      ),
    );
    expect(requested("POST /widget/identify")).toHaveLength(2);
    expect(requested("POST /widget/anonymous-session")).toHaveLength(0);
  });

  it("still opens the panel when a deep link is malformed", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: "chat" });
    await waitFor(() =>
      expect(requested("POST /widget/anonymous-session")).toHaveLength(1),
    );
    await waitFor(() =>
      expect(requested("GET /widget/posts?limit=50")).toHaveLength(1),
    );
  });

  it("hides feedback that a private portal denies and keeps the widget usable", async () => {
    table["GET /widget/posts?limit=50"] = () => ({
      status: 403,
      body: { message: "Portal access required" },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: { view: "new-post" } });
    await waitFor(() =>
      expect(requested("GET /widget/posts?limit=50")).toHaveLength(1),
    );
    // The new-post deep link applies only after a successful load, so reaching the composer
    // proves the 403 did not fail the load. Its submit action is withheld.
    await screen.findByText("Sending is not available right now.");
    await screen.findByRole("button", { name: "Post" });
    expect(screen.queryByText("Could not load the latest content.")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Post" }).disabled,
    ).toBe(true);
  });

  it("refuses an unverified identity and ignores another origin after the first message", async () => {
    mount();
    fromParent({
      type: "quackback:identify",
      data: { id: "u1", email: "ada@example.test" },
    });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        {
          type: "quackback:identify-result",
          success: false,
          user: null,
          error: "The API identifies visitors only with a signed ssoToken",
        },
        HOST,
      ),
    );
    expect(requested("POST /widget/identify")).toHaveLength(0);
    fromParent({ type: "quackback:open", data: {} }, "https://evil.test");
    await act(async () => {});
    expect(requested("POST /widget/anonymous-session")).toHaveLength(0);
  });

  it("reports unread replies to the SDK and marks a thread read through its newest message", async () => {
    let unread = 1;
    table["GET /widget/config.json"] = () => ({
      body: {
        enabled: true,
        config: {
          tabs: {
            feedback: false,
            changelog: false,
            help: false,
            messenger: true,
          },
          theme: { themeMode: "light" },
        },
      },
    });
    table["GET /widget/conversations?limit=20"] = () => ({
      body: { items: [{ id: "c1" }] },
    });
    table["GET /widget/conversations/c1"] = () => ({
      body: {
        conversation: {
          id: "c1",
          subject: "Billing",
          preview: null,
          unreadCount: unread,
        },
        messages: [
          {
            id: "m1",
            fromVisitor: true,
            author: null,
            content: "Hi",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "m2",
            fromVisitor: false,
            author: { name: "Ana", avatarUrl: null },
            content: "Hello",
            createdAt: "2026-11-01T00:01:00.000Z",
          },
        ],
      },
    });
    table["GET /widget/unread"] = () => ({ body: { unreadCount: unread } });
    table["PUT /widget/conversations/c1/read"] = () => {
      unread = 0;
      return { body: { unreadCount: 0, changed: true } };
    };
    mount();
    fromParent({ type: "quackback:identify", data: null });
    fromParent({ type: "quackback:open", data: { view: "messages" } });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "quackback:unread", count: 1 },
        HOST,
      ),
    );
    // The messages deep link applies once the data has loaded.
    await screen.findByRole("heading", { name: "Messages" });
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "quackback:unread", count: 0 },
        HOST,
      ),
    );
    expect(requested("PUT /widget/conversations/c1/read")[0]!.init.body).toBe(
      '{"throughMessageId":"m2"}',
    );
  });

  it("shows an unavailable state while the workspace has the widget off", async () => {
    table["GET /widget/config.json"] = () => ({
      body: { enabled: false, config: null },
    });
    mount();
    await screen.findByText("This widget is not available right now.");
    fireEvent.click(screen.getByRole("button", { name: "Close widget" }));
    fromParent({ type: "quackback:open", data: {} });
    fireEvent.click(screen.getByRole("button", { name: "Close widget" }));
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "quackback:close" },
      HOST,
    );
  });

  describe("screenshots and page context (RFC 0003 feature 6)", () => {
    const png = () =>
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])],
        "screenshot.png",
        { type: "image/png" },
      );
    const created = {
      ...post,
      id: "p2",
      title: "Save fails",
      status: { id: "s1", name: "Open", color: "#000000" },
    };
    const identified = async () => {
      mount();
      fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
      fromParent({
        type: "quackback:metadata",
        data: {
          plan: "pro",
          pageUrl: "https://host.test/billing",
          browser: "spoofed",
          ["k".repeat(65)]: "dropped",
        },
      });
      fromParent({ type: "quackback:open", data: { view: "new-post" } });
      return screen.findByLabelText("Your feedback");
    };

    it("uploads an attached image once, and posts it with the page and browser", async () => {
      table["POST /widget/uploads"] = () => ({
        body: {
          key: "k1",
          uploadUrl: "https://storage.test/put",
          headers: { "Content-Type": "image/png" },
          expiresAt: "2026-11-14T00:00:00.000Z",
        },
      });
      table["PUT https://storage.test/put"] = () => ({ body: {} });
      table["POST /widget/files"] = () => ({ body: { id: "file_1" } });
      let lost = true;
      table["POST /widget/posts"] = () =>
        lost
          ? ((lost = false), { status: 503, body: { message: "Busy" } })
          : { body: { ...created, replayed: false } };
      const field = await identified();
      fireEvent.change(field, { target: { value: "Save fails" } });
      fireEvent.change(screen.getByLabelText("Choose images"), {
        target: { files: [png()] },
      });
      await screen.findByRole("button", { name: "Edit screenshot.png" });
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
      await screen.findByRole("alert");
      // The retry reuses the upload, so its idempotency key still fits.
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
      await waitFor(() =>
        expect(requested("POST /widget/posts")).toHaveLength(2),
      );
      expect(requested("POST /widget/uploads")).toHaveLength(1);
      expect(requested("PUT https://storage.test/put")[0]!.init).toMatchObject({
        credentials: "omit",
        headers: { "Content-Type": "image/png" },
      });
      const [first, second] = requested("POST /widget/posts").map((call) =>
        JSON.parse(String(call.init.body)),
      );
      expect(second).toEqual(first);
      expect(first).toMatchObject({
        content: "Save fails",
        attachmentIds: ["file_1"],
        metadata: {
          plan: "pro",
          pageUrl: "https://host.test/billing",
          browser: expect.not.stringContaining("spoofed"),
        },
      });
      expect(Object.keys(first.metadata)).toHaveLength(3);
    });

    it("asks the host page for a capture and reviews the image before attaching", async () => {
      await identified();
      fireEvent.click(
        screen.getByRole("button", { name: "Capture screenshot" }),
      );
      await waitFor(() => expect(posted("quackback:capture")).toHaveLength(1));
      const [[request]] = posted("quackback:capture");
      // Another ID is not the answer to this request.
      fromParent({
        type: "quackback:capture-result",
        data: { id: "other", image: png() },
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      fromParent({
        type: "quackback:capture-result",
        data: { id: request.id, image: png() },
      });
      expect(
        await screen.findByRole("heading", { name: "Review image" }),
      ).toBeDefined();
    });

    it("explains a failed capture and keeps the composer", async () => {
      await identified();
      fireEvent.click(
        screen.getByRole("button", { name: "Capture screenshot" }),
      );
      await waitFor(() => expect(posted("quackback:capture")).toHaveLength(1));
      const [[request]] = posted("quackback:capture");
      fromParent({
        type: "quackback:capture-result",
        data: { id: request.id, image: null },
      });
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Could not capture the page",
      );
    });

    it("offers no image or screenshot action to an anonymous visitor", async () => {
      mount();
      fromParent({ type: "quackback:identify", data: { anonymous: true } });
      fromParent({ type: "quackback:open", data: { view: "new-post" } });
      await screen.findByLabelText("Your feedback");
      expect(
        screen.queryByRole("button", { name: "Attach images" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Capture screenshot" }),
      ).toBeNull();
    });
  });
});
