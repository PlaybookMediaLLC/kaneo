import { describe, expect, it } from "vite-plus/test";
import { getSurveyResultsFixture } from "../../../api/team/get-survey-results.fixture";
import { renderComponent } from "../../../test/render";
import { SurveyProperties } from "./survey-properties";

describe("SurveyProperties", () => {
  it("shows the type, the status, the responses and the last change", () => {
    const survey = getSurveyResultsFixture.ok().survey;
    const view = renderComponent(
      <SurveyProperties survey={{ ...survey, status: "active" }} total={3} />,
    );
    expect(view.getByText("Net Promoter Score (0 to 10)")).toBeInTheDocument();
    expect(view.getByText("Active")).toBeInTheDocument();
    expect(view.getByText("3 responses")).toBeInTheDocument();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      survey.updatedAt,
    );
  });
});
