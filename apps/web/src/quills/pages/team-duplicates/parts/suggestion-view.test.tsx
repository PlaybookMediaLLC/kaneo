import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { suggestionsFixture } from "../suggestions.fixture";
import { SuggestionView } from "./suggestion-view";

const first = suggestionsFixture.suggestion();
const second = suggestionsFixture.suggestion({
  id: "suggestion_test_2",
  source: { ...first.source, title: "CSV export" },
});

describe("SuggestionView", () => {
  it("shows the compact list, the open pair, its properties, the result and the decisions", () => {
    const onMove = vi.fn();
    const onMerge = vi.fn();
    const view = renderComponent(
      <SuggestionView
        workspaceId="workspace_test_1"
        suggestion={first}
        suggestions={[first, second]}
        message="Restored: “CSV export” and “Dark mode”."
        problem={{ kind: "failed" }}
        onMove={onMove}
        onBack={() => undefined}
        actions={{
          canDecide: true,
          busy: false,
          onMerge,
          onDismiss: () => undefined,
          onRestore: () => undefined,
        }}
      />,
    );
    expect(view.getByRole("region", { name: "Duplicates" })).toHaveTextContent(
      "CSV export",
    );
    expect(
      view.getByRole("heading", {
        level: 1,
        name: "“Dark theme” and “Dark mode”",
      }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("complementary", { name: "Details" }),
    ).toHaveTextContent("Pending");
    expect(view.getByRole("status")).toHaveTextContent(
      "Restored: “CSV export” and “Dark mode”.",
    );
    expect(view.getByRole("alert")).toBeInTheDocument();
    press("Next");
    expect(onMove).toHaveBeenCalledWith(second.id);
    press("Merge");
    expect(onMerge).toHaveBeenCalledOnce();
  });
});
