import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { SuggestionRow } from "./suggestion-row";

const suggestion = (status: "pending" | "dismissed") => ({
  id: "suggestion_test_1",
  status,
  source: {
    id: "post_test_1",
    title: "Dark theme",
    voteCount: 1,
    boardName: "Ideas",
    statusName: null,
  },
  target: {
    id: "post_test_2",
    title: "Dark mode",
    voteCount: 4,
    boardName: "Ideas",
    statusName: "Open",
  },
  hybridScore: 0.876,
  llmConfidence: 0.9,
  llmReasoning: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  resolvedAt: null,
});
const actions = () => ({
  onMerge: vi.fn(async () => undefined),
  onDismiss: vi.fn(async () => undefined),
  onRestore: vi.fn(async () => undefined),
});

describe("SuggestionRow", () => {
  it("names both posts in the merge and dismiss buttons", async () => {
    const calls = actions();
    const view = renderComponent(
      <ul>
        <SuggestionRow
          suggestion={suggestion("pending")}
          canDecide
          {...calls}
        />
      </ul>,
    );
    expect(view.getByText("88% match")).toBeInTheDocument();
    expect(view.getByText("1 vote")).toBeInTheDocument();
    expect(view.getByText("Ideas · Open")).toBeInTheDocument();
    press("Merge: “Dark theme” into “Dark mode”");
    await waitFor(() => expect(calls.onMerge).toHaveBeenCalledTimes(1));
    press("Dismiss: “Dark theme” and “Dark mode”");
    await waitFor(() => expect(calls.onDismiss).toHaveBeenCalledTimes(1));
    expect(view.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });

  it("offers only a restore for a dismissed pair", async () => {
    const calls = actions();
    const view = renderComponent(
      <ul>
        <SuggestionRow
          suggestion={suggestion("dismissed")}
          canDecide
          {...calls}
        />
      </ul>,
    );
    expect(view.getAllByRole("button")).toHaveLength(1);
    press("Restore: “Dark theme” and “Dark mode”");
    await waitFor(() => expect(calls.onRestore).toHaveBeenCalledTimes(1));
  });

  it("shows no decision without permission", () => {
    const view = renderComponent(
      <ul>
        <SuggestionRow
          suggestion={suggestion("pending")}
          canDecide={false}
          {...actions()}
        />
      </ul>,
    );
    expect(view.queryByRole("button")).not.toBeInTheDocument();
  });
});
