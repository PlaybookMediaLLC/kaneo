import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createApi } from "../src/adapter/api";
import { useWidgetSurvey } from "../src/adapter/surveys";
import { WidgetView } from "../src/ui/index.js";
import type { WidgetSurvey } from "../src/ui/types";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const nps: WidgetSurvey = {
  id: "survey_1",
  type: "nps",
  question: "How likely are you to recommend us?",
  options: [],
  scale: { min: 0, max: 10 },
};

describe("widget survey prompt", () => {
  it("shows the survey on the home tab, sends the score and thanks the visitor", async () => {
    const answer = vi.fn(async () => undefined);
    render(
      <WidgetView onClose={vi.fn()} survey={nps} onAnswerSurvey={answer} />,
    );
    const group = screen.getByRole("group", { name: nps.question });
    expect(group.querySelectorAll("button")).toHaveLength(11);
    const send = screen.getByRole("button", { name: "Send answer" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "9" }));
    expect(
      screen.getByRole("button", { name: "9" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(screen.getByLabelText("Comment (optional)"), {
      target: { value: " Fast " },
    });
    fireEvent.click(send);
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Thanks for your answer.",
    );
    expect(answer).toHaveBeenCalledWith("survey_1", {
      score: 9,
      comment: "Fast",
    });
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByText(nps.question)).toBeNull();
  });

  it("takes a choice for a poll and a text answer for an open question", async () => {
    const answer = vi.fn(async () => undefined);
    const { rerender } = render(
      <WidgetView
        onClose={vi.fn()}
        survey={{
          ...nps,
          id: "survey_2",
          type: "poll",
          options: ["CSV", "PDF"],
          scale: null,
        }}
        onAnswerSurvey={answer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith("survey_2", { choice: "PDF" }),
    );
    rerender(
      <WidgetView
        onClose={vi.fn()}
        survey={{ ...nps, id: "survey_3", type: "open", scale: null }}
        onAnswerSurvey={answer}
      />,
    );
    expect(screen.queryByRole("group")).toBeNull();
    const send = screen.getByRole("button", { name: "Send answer" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "Slack alerts" },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(answer).toHaveBeenLastCalledWith("survey_3", {
        comment: "Slack alerts",
      }),
    );
  });

  it("keeps the draft and shows an error when the answer fails", async () => {
    const answer = vi.fn(async () => {
      throw new Error("offline");
    });
    render(
      <WidgetView onClose={vi.fn()} survey={nps} onAnswerSurvey={answer} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/failed/);
    expect(
      screen.getByRole("button", { name: "3" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("widget survey adapter", () => {
  const setup = (reply: (url: string, init: RequestInit) => Response) => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) =>
      reply(url, init),
    );
    const api = createApi("/api/quills-public/acme", fetchImpl as never);
    return { api, fetchImpl };
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("reads the survey only for an open panel with a session", async () => {
    const { api, fetchImpl } = setup(() => json({ survey: nps }));
    const { result, rerender } = renderHook(
      ({ session, active }) => useWidgetSurvey(api, session, active),
      { initialProps: { session: null as number | null, active: true } },
    );
    rerender({ session: 1, active: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    rerender({ session: 1, active: true });
    await waitFor(() => expect(result.current.survey?.id).toBe("survey_1"));
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "/api/quills-public/acme/widget/surveys/active",
    );
    // A new session (another visitor) drops the old survey until its own read.
    rerender({ session: 2, active: true });
    expect(result.current.survey).toBeNull();
  });

  it("treats an earlier answer as answered and keeps a dismissal for the session", async () => {
    const { api } = setup((url, init) =>
      init.method === "POST"
        ? json({ message: "You already answered this survey" }, 409)
        : json({ survey: nps }),
    );
    const { result } = renderHook(() => useWidgetSurvey(api, 1, true));
    await waitFor(() => expect(result.current.survey).not.toBeNull());
    await expect(
      result.current.onAnswerSurvey("survey_1", { score: 5 }),
    ).resolves.toBeUndefined();
    act(() => result.current.onDismissSurvey("survey_1"));
    expect(result.current.survey).toBeNull();
    const again = renderHook(() => useWidgetSurvey(api, 1, true));
    await waitFor(() =>
      expect(sessionStorage.getItem("qb-survey-dismissed")).toBe(
        '["survey_1"]',
      ),
    );
    expect(again.result.current.survey).toBeNull();
  });

  it("passes other failures to the prompt", async () => {
    const { api } = setup(() => json({ message: "Survey not found" }, 404));
    const { result } = renderHook(() => useWidgetSurvey(api, 1, true));
    await expect(
      result.current.onAnswerSurvey("survey_1", { score: 5 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("widget host survey", () => {
  it("shows an identified visitor's survey on the home tab and posts the answer", async () => {
    const { WidgetHost } = await import("../src/adapter/WidgetHost");
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });
    const table: Record<string, () => { status?: number; body: unknown }> = {
      "GET /widget/config.json": () => ({
        body: {
          config: {
            tabs: {
              feedback: false,
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
      "POST /widget/identify": () => ({
        body: {
          sessionToken: "known",
          user: { id: "u1", name: "Ada", email: null, avatarUrl: null },
        },
      }),
      "GET /widget/surveys/active": () => ({ body: { survey: nps } }),
      "POST /widget/surveys/survey_1/responses": () => ({
        body: { surveyId: "survey_1" },
      }),
    };
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const key = `${init.method} ${url.replace("/api/quills-public/acme", "")}`;
        calls.push(`${key} ${String(init.body ?? "")}`.trim());
        const reply = table[key]?.() ?? { status: 404, body: {} };
        return new Response(JSON.stringify(reply.body), {
          status: reply.status ?? 200,
        });
      }),
    );
    const send = (data: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            origin: "https://host.test",
            source: parent as never,
          }),
        );
      });
    try {
      render(
        <WidgetHost
          base="/api/quills-public/acme"
          params={new URLSearchParams()}
        />,
      );
      send({ type: "quackback:identify", data: { ssoToken: "a.b.c" } });
      send({ type: "quackback:open", data: {} });
      expect(await screen.findByText(nps.question)).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "10" }));
      fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
      await screen.findByText("Thanks for your answer.");
      expect(calls).toContain(
        'POST /widget/surveys/survey_1/responses {"score":10}',
      );
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      delete (window as { parent?: unknown }).parent;
    }
  });
});
