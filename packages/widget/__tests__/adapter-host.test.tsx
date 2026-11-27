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
  within,
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

  it("moves the anonymous session's activity to the person who identifies", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: { postId: "p1" } });
    await screen.findByRole("button", { name: "Vote · 3" });
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    await waitFor(() =>
      expect(requested("POST /widget/identify")).toHaveLength(1),
    );
    const [call] = requested("POST /widget/identify");
    expect(JSON.parse(call!.init.body as string)).toEqual({
      ssoToken: "a.b.c",
      previousToken: "anon",
    });
    expect(call!.init.headers).toMatchObject({ authorization: "Bearer anon" });
  });

  it("opens the portal signed in, handing the one-time link only to the tab it opened", async () => {
    table["POST /widget/identify"] = () => ({
      body: {
        sessionToken: "known",
        user,
        canPortalHandoff: true,
        portalSignIn: true,
      },
    });
    const link = `${location.origin}/api/quills-public/signed/portal-sign-in?code=c`;
    table["POST /widget/portal-sign-in"] = () => ({ body: { url: link } });
    const tab = { postMessage: vi.fn(), close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);
    const fromTab = (source: unknown, origin = location.origin) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "quills:portal-sign-in", state: "e".repeat(64) },
          origin,
          source: source as Window,
        }),
      );
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: {} });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in portal" }),
    );
    // The tab opens on the click, at the account sign-in start that marks its browser.
    expect(open).toHaveBeenCalledWith(
      `${location.origin}/api/auth/quills/portal-sign-in?via=widget&workspace=acme`,
      "_blank",
    );
    // Another window, or this tab on another origin, does not get a link.
    fromTab({});
    fromTab(tab, "https://evil.test");
    expect(requested("POST /widget/portal-sign-in")).toHaveLength(0);
    fromTab(tab);
    await waitFor(() =>
      expect(tab.postMessage).toHaveBeenCalledWith(
        { type: "quills:portal-sign-in-url", url: link },
        location.origin,
      ),
    );
    expect(
      JSON.parse(
        requested("POST /widget/portal-sign-in")[0]!.init.body as string,
      ),
    ).toEqual({ next: "", state: "e".repeat(64) });
    // Widget sign-in replaces the mailed link.
    expect(requested("POST /widget/portal-link")).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
    open.mockRestore();
  });

  it("keeps the anonymous session when the host's token is refused", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: { postId: "p1" } });
    await screen.findByRole("button", { name: "Vote · 3" });
    table["POST /widget/identify"] = () => ({
      status: 403,
      body: { message: "Invalid or expired ssoToken" },
    });
    fromParent({ type: "quackback:identify", data: { ssoToken: "bad" } });
    await waitFor(() =>
      expect(posted("quackback:identify-result").at(-1)?.[0]).toMatchObject({
        success: false,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Feedback" }));
    await waitFor(() =>
      expect(
        requested("GET /widget/posts?limit=50").at(-1)!.init.headers,
      ).toMatchObject({
        authorization: "Bearer anon",
      }),
    );
    expect(requested("POST /widget/anonymous-session")).toHaveLength(1);
  });

  it("identifies a visitor without an anonymous session without previousToken", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    await waitFor(() =>
      expect(requested("POST /widget/identify")).toHaveLength(1),
    );
    const [call] = requested("POST /widget/identify");
    expect(JSON.parse(call!.init.body as string)).toEqual({
      ssoToken: "a.b.c",
    });
    expect(call!.init.headers).not.toHaveProperty("authorization");
  });

  it("offers Open in portal to an identified visitor and mails the sign-in link through the API", async () => {
    table["POST /widget/identify"] = () => ({
      body: { sessionToken: "known", user, canPortalHandoff: true },
    });
    let refuse = true;
    table["POST /widget/portal-link"] = () =>
      refuse
        ? ((refuse = false),
          {
            status: 403,
            body: { message: "A sign-in link cannot be sent now" },
          })
        : { body: { sent: true, delivery: "sent" } };
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: {} });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in portal" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The portal could not be opened. Try again later.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in portal" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Check your email for a sign-in link to the portal.",
    );
    expect(requested("POST /widget/portal-link")).toHaveLength(2);
    expect(
      requested("POST /widget/portal-link")[1]!.init.headers,
    ).toMatchObject({ authorization: "Bearer known" });
    // The link expires after 5 minutes: the visitor can ask again.
    fireEvent.click(screen.getByRole("button", { name: "Open in portal" }));
    await waitFor(() =>
      expect(requested("POST /widget/portal-link")).toHaveLength(3),
    );
  });

  it("says the link reaches only an account while the portal's registration is closed", async () => {
    table["POST /widget/identify"] = () => ({
      body: { sessionToken: "known", user, canPortalHandoff: true },
    });
    table["POST /widget/portal-link"] = () => ({
      body: { sent: true, delivery: "if_account" },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: {} });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in portal" }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "If your email has an account on the portal, a sign-in link is on its way. Check your email.",
    );
  });

  it("identifies again when Open in portal finds the session ended by a portal link", async () => {
    table["POST /widget/identify"] = () => ({
      body: { sessionToken: "known", user, canPortalHandoff: true },
    });
    table["POST /widget/portal-link"] = () => ({
      status: 401,
      body: { message: "Valid widget session required" },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: {} });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open in portal" }),
    );
    await waitFor(() =>
      expect(requested("POST /widget/identify")).toHaveLength(2),
    );
  });

  it("hides Open in portal when the API does not offer it", async () => {
    table["POST /widget/identify"] = () => ({
      body: { sessionToken: "known", user, canPortalHandoff: false },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: {} });
    await screen.findByText("How can we help?");
    expect(screen.queryByRole("button", { name: "Open in portal" })).toBeNull();
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

  it("opens a new post pre-filled from the deep link and posts it on the named board", async () => {
    table["GET /widget/boards"] = () => ({
      body: { items: [{ id: "b2", slug: "bugs", name: "Bugs" }] },
    });
    table["POST /widget/posts"] = () => ({ body: post });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({
      type: "quackback:open",
      data: {
        view: "new-post",
        title: "Bug:",
        body: "Export fails",
        board: "bugs",
      },
    });
    const box = await screen.findByRole("textbox", { name: "Your feedback" });
    await waitFor(() =>
      expect((box as HTMLTextAreaElement).value).toBe("Bug:\nExport fails"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(requested("POST /widget/posts")).toHaveLength(1),
    );
    expect(
      JSON.parse(requested("POST /widget/posts")[0]!.init.body as string),
    ).toMatchObject({
      content: "Bug:\nExport fails",
      boardId: "b2",
    });
  });

  it("suggests similar requests from the whole board while typing and takes a vote", async () => {
    table["GET /widget/posts/similar?title=Export+to+CSV&limit=3"] = () => ({
      body: {
        items: [
          {
            id: "p9",
            title: "CSV export",
            voteCount: 7,
            stage: "open",
            board: { id: "b1", slug: "ideas" },
          },
        ],
      },
    });
    table["PUT /widget/posts/p9/vote"] = () => ({
      body: { postId: "p9", voted: true, voteCount: 8, changed: true },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: { view: "new-post" } });
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Your feedback" }),
      { target: { value: "Export to CSV" } },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Vote for CSV export" }),
    );
    const voted = await screen.findByRole("button", {
      name: "Voted for CSV export",
    });
    expect(voted.textContent).toBe("8");
    expect(requested("PUT /widget/posts/p9/vote")[0]!.init.body).toBe(
      '{"voted":true}',
    );
    expect(requested("POST /widget/posts")).toHaveLength(0);
  });

  it("opens help with the deep link's search", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.help = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/help/articles?limit=100"] = () => ({
      body: { articles: [] },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({
      type: "quackback:open",
      data: { view: "help", query: "invoices" },
    });
    const search = await screen.findByRole("searchbox", {
      name: "Search for help",
    });
    await waitFor(() =>
      expect((search as HTMLInputElement).value).toBe("invoices"),
    );
  });

  it("opens a help category named by the deep link", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.help = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    const article = (id: string, title: string, category: string) => ({
      id,
      title,
      description: null,
      updatedAt: "2026-11-01T00:00:00.000Z",
      author: null,
      category: { name: category },
    });
    table["GET /widget/help/articles?limit=100"] = () => ({
      body: {
        articles: [
          article("a1", "Pay an invoice", "Billing"),
          article("a2", "Invite a teammate", "Teams"),
        ],
      },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({
      type: "quackback:open",
      data: { view: "help", category: "billing" },
    });
    await screen.findByRole("button", { name: "Pay an invoice" });
    expect(
      screen.queryByRole("button", { name: "Invite a teammate" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "All categories" })).toBeTruthy();
  });

  it("opens a new message pre-filled from the deep link", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.messenger = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/conversations?limit=20"] = () => ({
      body: { items: [] },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({
      type: "quackback:open",
      data: { view: "messages", body: "My export failed" },
    });
    const box = await screen.findByLabelText("Your message");
    await waitFor(() =>
      expect((box as HTMLTextAreaElement).value).toBe("My export failed"),
    );
  });

  it("lets an identified visitor subscribe to updates from the Updates tab", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.changelog = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/changelog?limit=50"] = () => ({ body: { entries: [] } });
    table["GET /widget/changelog/unread"] = () => ({ body: { count: 0 } });
    table["GET /widget/changelog/subscription"] = () => ({
      body: { subscribed: false },
    });
    table["PUT /widget/changelog/subscription"] = () => ({
      body: { subscribed: true },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: { view: "changelog" } });
    fireEvent.click(
      await screen.findByRole("button", { name: "Get updates by email" }),
    );
    await screen.findByRole("button", { name: "Subscribed to updates" });
    expect(requested("PUT /widget/changelog/subscription")).toHaveLength(1);
  });

  it("shows the team's avatars, online state, reply time and the workspace greeting on Home", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: Record<string, unknown> & { tabs: Record<string, boolean> };
    };
    config.config.tabs.messenger = true;
    config.config.replyTime = "hours";
    config.config.home = { greeting: "Hello from Acme", subtitle: null };
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/conversations?limit=20"] = () => ({
      body: { items: [] },
    });
    table["GET /widget/presence"] = () => ({
      body: { agentsOnline: true, withinOfficeHours: true },
    });
    table["GET /widget/team-avatars"] = () => ({
      body: {
        items: [
          { name: "Grace", avatarUrl: null },
          { name: "Linus", avatarUrl: null },
        ],
      },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: {} });
    await screen.findByText(
      "We’re online now. Usually replies in a few hours.",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Hello from AcmeHow can we help?",
    );
    expect(
      document.querySelectorAll(".qb-team-avatars .qb-avatar"),
    ).toHaveLength(2);
    expect(
      posted("quackback:event").map(([message]) => message),
    ).toContainEqual({
      type: "quackback:event",
      name: "presence",
      payload: {
        online: true,
        withinOfficeHours: true,
        estimatedWaitMinutes: null,
        estimatedWaitRange: null,
        nextOpenAt: null,
      },
    });
  });

  it("shows the widget in the host page's language, right to left for Arabic", async () => {
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:locale", data: "fr-FR" });
    fromParent({ type: "quackback:open", data: {} });
    await screen.findByRole("button", { name: "Soumettre une demande" });
    expect(
      screen.getByRole("button", { name: "Fermer le widget" }),
    ).toBeTruthy();
    expect(
      document.querySelector("section.qb-widget")?.getAttribute("lang"),
    ).toBe("fr");
    fromParent({ type: "quackback:locale", data: "ar" });
    await screen.findByRole("button", { name: "إرسال طلب" });
    expect(
      document.querySelector("section.qb-widget")?.getAttribute("dir"),
    ).toBe("rtl");
  });

  it("shows an automatic answer that the API wrote with the visitor's message", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.messenger = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/conversations?limit=20"] = () => ({
      body: { items: [] },
    });
    const conversation = {
      id: "c1",
      subject: "Hello",
      preview: "Hello",
      unreadCount: 0,
    };
    table["POST /widget/conversations"] = () => ({
      body: {
        conversation,
        message: {
          id: "m1",
          fromVisitor: true,
          content: "Hello",
          createdAt: "2026-11-17T01:00:00.000Z",
        },
      },
    });
    table["GET /widget/conversations/c1/messages?after=m1&limit=100"] = () => ({
      body: {
        items: [
          {
            id: "m2",
            fromVisitor: false,
            senderType: "system",
            author: null,
            content: "The team is away and replies soon.",
            createdAt: "2026-11-17T01:00:00.100Z",
          },
        ],
      },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: { view: "messages" } });
    fireEvent.click(
      await screen.findByRole("button", { name: "New conversation" }),
    );
    fireEvent.change(await screen.findByLabelText("Your message"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("The team is away and replies soon.");
  });

  it("announces a new update to the SDK once, after the server records it", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.changelog = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    table["GET /widget/changelog/unread"] = () => ({
      body: {
        count: 2,
        announce: { id: "changelog_1", title: "Dark mode" },
        autoOpen: false,
      },
    });
    table["PUT /widget/changelog/announced"] = () => ({
      body: { announcedAt: "2026-11-17T00:00:00.000Z" },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    await waitFor(() =>
      expect(posted("quackback:announce").map(([message]) => message)).toEqual([
        {
          type: "quackback:announce",
          entryId: "changelog_1",
          title: "Dark mode",
          open: false,
        },
      ]),
    );
    expect(requested("PUT /widget/changelog/announced")).toHaveLength(1);
    expect(posted("quackback:unread").at(-1)?.[0]).toMatchObject({ count: 2 });
  });

  it("shows an identified visitor's activity, counts it on the badge and marks it read", async () => {
    const activity = {
      id: "notification_1",
      postId: "p1",
      title: "Dark mode",
      kind: "reply",
      summary: "We started on it",
      createdAt: "2026-11-01T00:00:00.000Z",
      unread: true,
    };
    table["GET /widget/activity"] = () => ({
      body: { items: [activity], unreadCount: 1 },
    });
    table["PUT /widget/activity/notification_1/read"] = () => ({
      body: { item: { ...activity, unread: false }, unreadCount: 0 },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
    fromParent({ type: "quackback:open", data: { view: "notifications" } });
    // The notifications deep link opens the activity page directly.
    await screen.findByText("We started on it");
    expect(posted("quackback:unread").at(-1)?.[0]).toMatchObject({ count: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Mark as read/ }));
    await waitFor(() =>
      expect(
        requested("PUT /widget/activity/notification_1/read"),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(posted("quackback:unread").at(-1)?.[0]).toMatchObject({
        count: 0,
      }),
    );
  });

  it("lets an anonymous visitor get replies by email and tells the SDK", async () => {
    const config = table["GET /widget/config.json"]!({}).body as {
      config: { tabs: Record<string, boolean> };
    };
    config.config.tabs.messenger = true;
    table["GET /widget/config.json"] = () => ({ body: config });
    const thread = { id: "c1", subject: "Hi", preview: "Hi", unreadCount: 0 };
    table["GET /widget/conversations?limit=20"] = () => ({
      body: { items: [thread] },
    });
    table["GET /widget/conversations/c1"] = () => ({
      body: {
        conversation: thread,
        messages: [
          {
            id: "m1",
            fromVisitor: true,
            author: null,
            content: "Hi",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      },
    });
    table["GET /widget/contact-email"] = () => ({
      body: {
        currentEmail: null,
        requiresCurrentCode: false,
        pendingEmail: null,
      },
    });
    table["POST /widget/contact-email"] = () => ({
      body: { ok: true, reason: null, principalId: "p" },
    });
    table["POST /widget/contact-email/confirm"] = () => ({
      body: { ok: true, email: "ada@example.test", principalId: "p" },
    });
    mount();
    fromParent({ type: "quackback:identify", data: { anonymous: true } });
    fromParent({ type: "quackback:open", data: { view: "messages" } });
    fireEvent.change(
      await screen.findByLabelText(
        "Your email, so you see replies after you leave",
      ),
      { target: { value: "Ada@Example.test" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    fireEvent.change(
      await screen.findByLabelText(
        "Enter the code we sent to ada@example.test",
      ),
      { target: { value: "123456" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Replies also go to ada@example.test.");
    expect(
      JSON.parse(
        String(requested("POST /widget/contact-email/confirm")[0]!.init.body),
      ),
    ).toEqual({ email: "ada@example.test", code: "123456" });
    expect(
      posted("quackback:event").map(([message]) => message),
    ).toContainEqual({
      type: "quackback:event",
      name: "email-submitted",
      payload: { email: "ada@example.test" },
    });
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

  it("shows only the tabs that the workspace turned on, and opens Home for a tab that is off", async () => {
    // The default config here: feedback on; messages, help and updates off; home on.
    mount();
    fromParent({ type: "quackback:identify", data: null });
    fromParent({ type: "quackback:open", data: { view: "messages" } });
    // Home, after the data loads: the messages deep link cannot open an off tab.
    expect(await screen.findByText("Submit a request")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Widget navigation" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Home", "Feedback"]);
    expect(screen.queryByRole("heading", { name: "Messages" })).toBeNull();
    expect(screen.queryByText("Send us a message")).toBeNull();
    expect(screen.queryByText("Search for help")).toBeNull();
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

    it("uploads an image with a new message, without the camera", async () => {
      const config = table["GET /widget/config.json"]!({}).body as {
        config: { tabs: Record<string, boolean> };
      };
      config.config.tabs.messenger = true;
      table["GET /widget/config.json"] = () => ({ body: config });
      table["GET /widget/conversations?limit=20"] = () => ({
        body: { items: [] },
      });
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
      table["POST /widget/conversations"] = () => ({
        status: 503,
        body: { message: "Busy" },
      });
      mount();
      fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
      fromParent({ type: "quackback:open", data: { view: "messages" } });
      fireEvent.click(
        await screen.findByRole("button", { name: "New conversation" }),
      );
      fireEvent.change(await screen.findByLabelText("Your message"), {
        target: { value: "See this" },
      });
      expect(
        screen.queryByRole("button", { name: "Capture screenshot" }),
      ).toBeNull();
      fireEvent.change(screen.getByLabelText("Choose images"), {
        target: { files: [png()] },
      });
      await screen.findByRole("button", { name: "Edit screenshot.png" });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() =>
        expect(requested("POST /widget/conversations")).toHaveLength(1),
      );
      expect(
        JSON.parse(
          String(requested("POST /widget/conversations")[0]!.init.body),
        ),
      ).toMatchObject({ content: "See this", attachmentIds: ["file_1"] });
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
  describe("AI title and board draft (issue #106)", () => {
    const words = "please add a dark theme, my eyes hurt at night";
    const withAi = () => {
      const config = table["GET /widget/config.json"]!({} as RequestInit)
        .body as { config: Record<string, unknown> };
      table["GET /widget/config.json"] = () => ({
        body: { ...config, config: { ...config.config, ai: true } },
      });
    };
    const compose = async () => {
      mount();
      fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
      fromParent({ type: "quackback:open", data: { view: "new-post" } });
      const field = await screen.findByLabelText("Your feedback");
      fireEvent.change(field, { target: { value: words } });
      return field;
    };

    it("offers no draft when the instance has no AI provider", async () => {
      await compose();
      expect(
        screen.queryByRole("button", { name: "Suggest a title" }),
      ).toBeNull();
    });

    it("shows the suggested title, board and similar requests, votes, and posts the visitor's words only after Post", async () => {
      withAi();
      table["POST /widget/post-draft/improve"] = () => ({
        body: { title: "Dark mode", boardId: "b2", boardName: "Themes" },
      });
      table["GET /widget/posts/similar?title=Dark%20mode&limit=5"] = () => ({
        body: { items: [{ id: "p1", title: "Dark mode", voteCount: 3 }] },
      });
      table["POST /widget/posts"] = () => ({
        body: { ...post, id: "p9", title: "Dark mode", content: words },
      });
      await compose();
      fireEvent.click(
        await screen.findByRole("button", { name: "Suggest a title" }),
      );
      const panel = await screen.findByRole("region", {
        name: "Suggested title",
      });
      expect(panel.textContent).toContain("Dark mode");
      expect(panel.textContent).toContain("Board: Themes");
      const [draft] = requested("POST /widget/post-draft/improve");
      expect(JSON.parse(String(draft!.init.body))).toEqual({
        title: "",
        details: words,
      });
      expect(requested("POST /widget/posts")).toHaveLength(0);
      fireEvent.click(
        within(panel).getByRole("button", { name: "Vote: Dark mode" }),
      );
      await waitFor(() =>
        expect(requested("PUT /widget/posts/p1/vote")).toHaveLength(1),
      );
      expect(
        await within(panel).findByRole("button", { name: "Voted: Dark mode" }),
      ).toHaveProperty("disabled", true);
      fireEvent.click(
        within(panel).getByRole("button", { name: "Post with this title" }),
      );
      await waitFor(() =>
        expect(requested("POST /widget/posts")).toHaveLength(1),
      );
      const [created] = requested("POST /widget/posts");
      expect(JSON.parse(String(created!.init.body))).toMatchObject({
        title: "Dark mode",
        content: words,
        boardId: "b2",
      });
    });

    it("keeps the manual path when the draft fails", async () => {
      withAi();
      table["POST /widget/post-draft/improve"] = () => ({
        status: 409,
        body: { message: "The workspace reached its monthly AI limit" },
      });
      table["POST /widget/posts"] = () => ({ body: { ...post, id: "p9" } });
      await compose();
      fireEvent.click(
        await screen.findByRole("button", { name: "Suggest a title" }),
      );
      expect((await screen.findByRole("alert")).textContent).toContain(
        "You can still post your feedback as written",
      );
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
      await waitFor(() =>
        expect(requested("POST /widget/posts")).toHaveLength(1),
      );
      const [created] = requested("POST /widget/posts");
      const body = JSON.parse(String(created!.init.body));
      expect(body.content).toBe(words);
      expect(body.title).toBeUndefined();
    });
  });
  describe("board custom fields (issue #71)", () => {
    it("asks for the default board's public fields, blocks Post until a required one is set, and sends them typed", async () => {
      table["GET /widget/boards"] = () => ({
        body: {
          items: [
            {
              id: "b0",
              slug: "closed",
              name: "Announcements",
              canSubmit: false,
              fields: [],
            },
            {
              id: "b1",
              slug: "ideas",
              name: "Ideas",
              canSubmit: true,
              fields: [
                {
                  key: "plan",
                  label: "Plan",
                  type: "select",
                  required: true,
                  options: ["Free", "Pro"],
                },
                {
                  key: "seats",
                  label: "Seats",
                  type: "number",
                  required: false,
                },
              ],
            },
          ],
        },
      });
      table["POST /widget/posts"] = () => ({ body: { ...post, id: "p9" } });
      mount();
      fromParent({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
      fromParent({ type: "quackback:open", data: { view: "new-post" } });
      const field = await screen.findByLabelText("Your feedback");
      fireEvent.change(field, { target: { value: "Export to CSV" } });
      const plan = await screen.findByLabelText("Plan (required)");
      expect(screen.getByText("Fill in Plan to post.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Post" })).toHaveProperty(
        "disabled",
        true,
      );
      fireEvent.change(plan, { target: { value: "Pro" } });
      fireEvent.change(screen.getByLabelText("Seats"), {
        target: { value: "4" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Post" }));
      await waitFor(() =>
        expect(requested("POST /widget/posts")).toHaveLength(1),
      );
      const [created] = requested("POST /widget/posts");
      expect(JSON.parse(String(created!.init.body))).toMatchObject({
        content: "Export to CSV",
        boardId: "b1",
        customFields: { plan: "Pro", seats: 4 },
      });
    });
  });
  describe("right-to-left layout (issue #117)", () => {
    const mountWith = (locale: string) =>
      render(
        <div style={{ height: 760 }}>
          <WidgetHost
            base="/api/quills-public/acme"
            params={new URLSearchParams({ locale })}
          />
        </div>,
      );

    it("lays the panel out right to left for Arabic", async () => {
      const view = mountWith("ar");
      // The panel's label is in Arabic too.
      const panel = await view.findByRole("region", { name: "دعم Quills" });
      expect(panel.getAttribute("dir")).toBe("rtl");
      expect(document.documentElement.getAttribute("dir")).toBe("rtl");
      // Each icon names itself, so the stylesheet mirrors the ones that point the way of reading.
      expect(panel.querySelector("svg.qb-icon-close")).not.toBeNull();
    });

    it("keeps a left-to-right language left to right", async () => {
      const view = mountWith("en-US");
      const panel = await view.findByRole("region", { name: /support/ });
      expect(panel.getAttribute("dir")).toBe("ltr");
      expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    });
  });
});
