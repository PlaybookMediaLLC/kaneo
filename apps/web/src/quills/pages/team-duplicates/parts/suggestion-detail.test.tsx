import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { suggestionsFixture } from "../suggestions.fixture";
import { SuggestionDetail } from "./suggestion-detail";

describe("SuggestionDetail", () => {
  it("shows both posts and the reason", () => {
    const view = renderComponent(
      <SuggestionDetail suggestion={suggestionsFixture.suggestion()} />,
    );
    expect(view.getByRole("region", { name: "Duplicate" })).toHaveTextContent(
      "Dark themeIdeas2 votes",
    );
    expect(view.getByRole("region", { name: "Keep" })).toHaveTextContent(
      "Dark modeIdeas · Planned9 votes",
    );
    expect(
      view.getByText("Both ask for a dark color scheme."),
    ).toBeInTheDocument();
  });

  it("leaves out a missing reason and counts one vote", () => {
    const view = renderComponent(
      <SuggestionDetail
        suggestion={suggestionsFixture.suggestion({
          llmReasoning: null,
          source: {
            id: "post_test_1",
            title: "Dark theme",
            voteCount: 1,
            boardName: "Ideas",
            statusName: null,
          },
        })}
      />,
    );
    expect(view.getByText("1 vote")).toBeInTheDocument();
    expect(view.queryByText(/color scheme/)).toBeNull();
  });
});
