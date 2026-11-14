import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { deleteSurveyFixture } from "../../api/team/delete-survey.fixture";
import { getSurveyResultsFixture } from "../../api/team/get-survey-results.fixture";
import { listSurveysFixture } from "../../api/team/list-surveys.fixture";
import { setSurveyStatusFixture } from "../../api/team/set-survey-status.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderComponent, renderPage } from "../../test/render";
import { ShortcutListener } from "../../ui/upstream";
import { meta } from "./meta";
import { TeamSurveyPage } from "./team-survey-page";

const survey = {
  ...getSurveyResultsFixture.ok().survey,
  id: "surveyId_test_1",
  question: "How likely?",
};
const results = (
  overrides: Partial<ReturnType<typeof getSurveyResultsFixture.ok>> = {},
) => getSurveyResultsFixture.ok({ survey, ...overrides });
const other = { ...survey, id: "survey_test_2", question: "Which plan?" };
/** The two page queries: the results of the open survey and the list. */
const prepare = (overrides = {}) => {
  const api = mockApi();
  api.reply(results(overrides));
  api.reply(listSurveysFixture.ok({ surveys: [survey, other] }));
  return api;
};

describe("TeamSurveyPage", () => {
  describePageContract(meta, TeamSurveyPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        prepare();
      },
    },
    done: {
      prepare: () => {
        prepare({ survey: { ...survey, status: "closed" } });
      },
    },
  });

  describe("behavior", () => {
    it("shows the score, a bar for each score, the comments and the properties", async () => {
      prepare({
        survey: { ...survey, status: "active" },
        total: 3,
        score: 33,
        scores: Array.from({ length: 11 }, (_, value) => ({
          value,
          count: value === 10 ? 2 : value === 3 ? 1 : 0,
        })),
        comments: [
          {
            id: "survey_response_test_1",
            comment: "Fast exports",
            score: 10,
            choice: null,
            respondent: "Ada",
            createdAt: "2026-11-01T00:00:00.000Z",
          },
          {
            id: "survey_response_test_2",
            comment: "Slow search",
            score: 3,
            choice: null,
            respondent: null,
            createdAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      });
      const view = renderPage(TeamSurveyPage, meta);
      expect(
        await view.findByRole("heading", { level: 1, name: "How likely?" }),
      ).toBeInTheDocument();
      expect(view.getByText("Net Promoter Score: 33")).toBeInTheDocument();
      expect(view.getAllByRole("meter")).toHaveLength(11);
      expect(view.getByRole("meter", { name: "10: 2 of 3" })).toBeVisible();
      expect(view.getByText("Fast exports")).toBeInTheDocument();
      expect(view.getByText("Ada")).toBeInTheDocument();
      expect(view.getByText("Unknown person")).toBeInTheDocument();
      expect(
        view.getByRole("complementary", { name: "Details" }),
      ).toHaveTextContent("Active");
      expect(
        view.getByRole("button", { name: "Close survey" }),
      ).toBeInTheDocument();
      expect(
        view.queryByRole("button", { name: "Delete draft" }),
      ).not.toBeInTheDocument();
    });

    it("activates a draft and shows its new status", async () => {
      const api = prepare();
      api.reply(setSurveyStatusFixture.ok({ status: "active" }));
      api.reply(listSurveysFixture.ok({ surveys: [survey, other] }));
      api.reply(results({ survey: { ...survey, status: "active" } }));
      const view = renderPage(TeamSurveyPage, meta);
      await view.findByRole("button", { name: "Activate survey" });
      press("Activate survey");
      await waitFor(() =>
        expect(api.calls("setQuillsSurveyStatus")).toHaveLength(1),
      );
      expect(await api.calls("setQuillsSurveyStatus")[0]!.json()).toEqual({
        status: "active",
      });
      expect(
        await view.findByRole("button", { name: "Close survey" }),
      ).toBeInTheDocument();
    });

    it("closes an active survey and shows a failed attempt", async () => {
      const api = prepare({ survey: { ...survey, status: "active" } });
      api.fail();
      api.reply(setSurveyStatusFixture.ok({ status: "closed" }));
      api.reply(listSurveysFixture.ok({ surveys: [survey, other] }));
      api.reply(results({ survey: { ...survey, status: "closed" } }));
      const view = renderPage(TeamSurveyPage, meta);
      await view.findByRole("button", { name: "Close survey" });
      press("Close survey");
      expect(await view.findByRole("alert")).toBeInTheDocument();
      press("Close survey");
      await waitFor(() =>
        expect(api.calls("setQuillsSurveyStatus")).toHaveLength(2),
      );
      expect(await api.calls("setQuillsSurveyStatus")[1]!.json()).toEqual({
        status: "closed",
      });
      await waitFor(() =>
        expect(
          view.queryByRole("button", { name: "Close survey" }),
        ).not.toBeInTheDocument(),
      );
      expect(view.queryByRole("alert")).toBeNull();
    });

    it("deletes a draft and links back to the list", async () => {
      const api = prepare();
      api.reply(deleteSurveyFixture.ok());
      api.reply(listSurveysFixture.ok({ surveys: [other] }));
      const view = renderPage(TeamSurveyPage, meta);
      await view.findByRole("button", { name: "Delete draft" });
      press("Delete draft");
      expect(await view.findByText("The draft is deleted")).toBeVisible();
      // The deleted survey's results are not read again.
      expect(api.calls("getQuillsSurveyResults")).toHaveLength(1);
      expect(view.getByRole("link", { name: "All surveys" })).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/surveys",
      );
    });

    it("moves to the next survey by key and back to the list", async () => {
      prepare();
      renderComponent(<ShortcutListener />);
      const view = renderPage(TeamSurveyPage, meta);
      expect(
        await view.findByRole("link", { name: /Which plan\?/ }),
      ).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/surveys/survey_test_2",
      );
      fireEvent.keyDown(document.body, { key: "j" });
      await waitFor(() =>
        expect(view.router.state.location.pathname).toBe(
          "/feedback/workspace_test_1/surveys/survey_test_2",
        ),
      );
      press("Back to the list");
      await waitFor(() =>
        expect(view.router.state.location.pathname).toBe(
          "/feedback/workspace_test_1/surveys",
        ),
      );
    });

    it("hides the actions without the permissions", async () => {
      prepare();
      const view = renderPage(TeamSurveyPage, meta, {
        permissions: { update: false, delete: false },
      });
      expect(await view.findByText("No score yet")).toBeInTheDocument();
      expect(view.queryByRole("group", { name: "Survey actions" })).toBeNull();
    });
  });
});

vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleUnauthorized: vi.fn(),
}));
