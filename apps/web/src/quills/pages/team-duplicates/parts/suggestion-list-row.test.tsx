import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { suggestionsFixture } from "../suggestions.fixture";
import { SuggestionListRow } from "./suggestion-list-row";

describe("SuggestionListRow", () => {
  it("shows the duplicate, the post to keep and the match, and opens the pair", () => {
    const onOpen = vi.fn();
    const view = renderComponent(
      <SuggestionListRow
        suggestion={suggestionsFixture.suggestion()}
        href="/feedback/workspace_test_1/duplicates"
        onOpen={onOpen}
      />,
    );
    const link = view.getByRole("link");
    for (const text of ["Dark theme", "Duplicate of “Dark mode”", "93% match"])
      expect(link).toHaveTextContent(text);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
