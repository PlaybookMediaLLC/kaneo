import { describe, expect, it, vi } from "vite-plus/test";
import { improvePortalPostDraftFixture } from "../api/feedback/improve-portal-post-draft.fixture";
import { press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { ImproveDraft } from "./improve-draft";

const viewer = { kind: "user", id: "account_test_1" } as const;
const boards = [{ id: "board_test_1" }];
const draft = () => ({
  boardId: "board_test_1",
  title: "csv",
  content: "x".repeat(5000),
});

describe("ImproveDraft", () => {
  it("sends the draft only when asked and applies the accepted suggestion", async () => {
    const api = mockApi();
    api.reply(
      improvePortalPostDraftFixture.ok({
        title: "Export reports as CSV",
        problem: "I cannot share a report with my team.",
        boardId: null,
      }),
    );
    const onApply = vi.fn();
    const view = renderComponent(
      <ImproveDraft
        workspaceId="workspace_test_1"
        viewer={viewer}
        boards={boards}
        draft={draft}
        onApply={onApply}
      />,
    );
    expect(api.calls()).toHaveLength(0);
    press("Improve with AI");
    const suggestion = await view.findByRole("region", {
      name: "Suggestion from AI",
    });
    expect(suggestion).toHaveTextContent("Export reports as CSV");
    const [request] = api.calls("improveQuillsPortalPostDraft");
    // The route reads at most 4,000 characters of details.
    expect(await request!.json()).toEqual({
      title: "csv",
      details: "x".repeat(4000),
      boardId: "board_test_1",
    });
    press("Use this");
    expect(onApply).toHaveBeenCalledWith({
      boardId: "board_test_1",
      title: "Export reports as CSV",
      content: "I cannot share a report with my team.",
    });
    expect(view.queryByRole("region")).not.toBeInTheDocument();
  });

  it("dismisses a suggestion without changing the draft", async () => {
    const api = mockApi();
    api.reply(improvePortalPostDraftFixture.ok());
    const onApply = vi.fn();
    const view = renderComponent(
      <ImproveDraft
        workspaceId="workspace_test_1"
        viewer={viewer}
        boards={boards}
        draft={draft}
        onApply={onApply}
      />,
    );
    press("Improve with AI");
    await view.findByRole("region", { name: "Suggestion from AI" });
    press("Dismiss");
    expect(view.queryByRole("region")).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([
    [409, "AI help is not available right now."],
    [429, "You asked for AI help too often. Try again in a few minutes."],
    [502, "AI help failed. Try again."],
  ] as const)("explains a %s refusal once", async (status, message) => {
    const api = mockApi();
    api.reply(improvePortalPostDraftFixture.problem(status).body, status);
    const view = renderComponent(
      <ImproveDraft
        workspaceId="workspace_test_1"
        viewer={viewer}
        boards={boards}
        draft={draft}
        onApply={vi.fn()}
      />,
    );
    press("Improve with AI");
    expect(await view.findByRole("alert")).toHaveTextContent(message);
  });

  it("asks again for the same draft after a failure", async () => {
    const api = mockApi();
    api.reply(improvePortalPostDraftFixture.problem(502).body, 502);
    api.reply(improvePortalPostDraftFixture.ok({ title: "Second try" }));
    const view = renderComponent(
      <ImproveDraft
        workspaceId="workspace_test_1"
        viewer={viewer}
        boards={boards}
        draft={draft}
        onApply={vi.fn()}
      />,
    );
    press("Improve with AI");
    await view.findByRole("alert");
    press("Improve with AI");
    expect(
      await view.findByRole("region", { name: "Suggestion from AI" }),
    ).toHaveTextContent("Second try");
    expect(api.calls("improveQuillsPortalPostDraft")).toHaveLength(2);
  });

  it("keeps the composer's board and title bounds", async () => {
    const api = mockApi();
    api.reply(improvePortalPostDraftFixture.ok({ boardId: "board_test_9" }));
    const onApply = vi.fn();
    const view = renderComponent(
      <ImproveDraft
        workspaceId="workspace_test_1"
        viewer={viewer}
        boards={boards}
        draft={() => ({ ...draft(), title: "t".repeat(250) })}
        onApply={onApply}
      />,
    );
    press("Improve with AI");
    await view.findByRole("region", { name: "Suggestion from AI" });
    const [request] = api.calls("improveQuillsPortalPostDraft");
    expect((await request!.json()).title).toBe("t".repeat(200));
    // A board that this composer does not offer, such as another board's page, is not used.
    press("Use this");
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "board_test_1" }),
    );
  });
});
