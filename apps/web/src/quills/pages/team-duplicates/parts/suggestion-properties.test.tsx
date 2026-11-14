import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { suggestionsFixture } from "../suggestions.fixture";
import { SuggestionProperties } from "./suggestion-properties";

describe("SuggestionProperties", () => {
  it("shows the status, the AI confidence and the found time", () => {
    const view = renderComponent(
      <SuggestionProperties suggestion={suggestionsFixture.suggestion()} />,
    );
    expect(view.getByText("Pending")).toBeInTheDocument();
    expect(view.getByText("90%")).toBeInTheDocument();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("names a pair without an AI rating", () => {
    const view = renderComponent(
      <SuggestionProperties
        suggestion={suggestionsFixture.suggestion({
          status: "dismissed",
          llmConfidence: null,
        })}
      />,
    );
    expect(view.getByText("Dismissed")).toBeInTheDocument();
    expect(view.getByText("Not rated")).toBeInTheDocument();
  });
});
