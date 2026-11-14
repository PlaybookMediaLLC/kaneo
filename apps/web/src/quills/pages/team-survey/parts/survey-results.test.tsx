import { describe, expect, it } from "vite-plus/test";
import { getSurveyResultsFixture } from "../../../api/team/get-survey-results.fixture";
import { renderComponent } from "../../../test/render";
import { SurveyResults } from "./survey-results";

const survey = getSurveyResultsFixture.ok().survey;

describe("SurveyResults", () => {
  it("shows a poll's answers and its comments without a score", () => {
    const view = renderComponent(
      <SurveyResults
        results={getSurveyResultsFixture.ok({
          survey: { ...survey, type: "poll" },
          total: 2,
          choices: [{ label: "CSV", count: 2 }],
          comments: [
            {
              id: "survey_response_test_1",
              comment: "Fast",
              score: null,
              choice: "CSV",
              respondent: "Ada",
              createdAt: "2026-11-01T00:00:00.000Z",
            },
          ],
        })}
      />,
    );
    expect(view.getByRole("meter", { name: "CSV: 2 of 2" })).toBeVisible();
    expect(view.getByText("Fast")).toBeInTheDocument();
    expect(view.queryByText("No score yet")).toBeNull();
  });

  it("says when a scored survey has no score and no comments", () => {
    const view = renderComponent(
      <SurveyResults results={getSurveyResultsFixture.ok()} />,
    );
    expect(view.getByText("No score yet")).toBeInTheDocument();
    expect(view.getByText("No comments yet.")).toBeInTheDocument();
    expect(view.queryByRole("meter")).toBeNull();
  });
});
