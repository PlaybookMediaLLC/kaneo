import { describe, expect, it, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { deleteSurveyFixture } from "../../api/team/delete-survey.fixture";
import { getSurveyResultsFixture } from "../../api/team/get-survey-results.fixture";
import { setSurveyStatusFixture } from "../../api/team/set-survey-status.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamSurveyPage } from "./team-survey-page";

const survey = getSurveyResultsFixture.ok().survey;
const results = (
  overrides: Partial<ReturnType<typeof getSurveyResultsFixture.ok>> = {},
) =>
  getSurveyResultsFixture.ok({
    survey: { ...survey, id: "survey_test_1", question: "How likely?" },
    ...overrides,
  });

describe("TeamSurveyPage", () => {
  describePageContract(meta, TeamSurveyPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(results());
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(results({ survey: { ...survey, status: "closed" } }));
      },
    },
  });

  describe("behavior", () => {
    it("shows the score, a bar for each score and the latest comments", async () => {
      const api = mockApi();
      api.reply(
        results({
          survey: { ...survey, status: "active", question: "How likely?" },
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
        }),
      );
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
        view.getByRole("button", { name: "Close survey" }),
      ).toBeInTheDocument();
      expect(
        view.queryByRole("button", { name: "Delete draft" }),
      ).not.toBeInTheDocument();
    });

    it("activates a draft and shows its new status", async () => {
      const api = mockApi();
      api.reply(results());
      api.reply(setSurveyStatusFixture.ok({ status: "active" }));
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

    it("closes an active survey", async () => {
      const api = mockApi();
      api.reply(results({ survey: { ...survey, status: "active" } }));
      api.reply(setSurveyStatusFixture.ok({ status: "closed" }));
      api.reply(results({ survey: { ...survey, status: "closed" } }));
      const view = renderPage(TeamSurveyPage, meta);
      await view.findByRole("button", { name: "Close survey" });
      press("Close survey");
      await waitFor(() =>
        expect(api.calls("setQuillsSurveyStatus")).toHaveLength(1),
      );
      expect(await api.calls("setQuillsSurveyStatus")[0]!.json()).toEqual({
        status: "closed",
      });
      await waitFor(() =>
        expect(
          view.queryByRole("button", { name: "Close survey" }),
        ).not.toBeInTheDocument(),
      );
    });

    it("deletes a draft and links back to the list", async () => {
      const api = mockApi();
      api.reply(results());
      api.reply(deleteSurveyFixture.ok());
      const view = renderPage(TeamSurveyPage, meta);
      await view.findByRole("button", { name: "Delete draft" });
      press("Delete draft");
      expect(await view.findByText("The draft is deleted")).toBeVisible();
      // The deleted survey's results are not read again.
      expect(api.calls("getQuillsSurveyResults")).toHaveLength(1);
      expect(
        view.getAllByRole("link", { name: "All surveys" })[0],
      ).toHaveAttribute(
        "href",
        "/dashboard/workspace/workspace_test_1/quills/surveys",
      );
    });

    it("hides the actions without the permissions", async () => {
      const api = mockApi();
      api.reply(results());
      const view = renderPage(TeamSurveyPage, meta, {
        permissions: { update: false, delete: false },
      });
      expect(await view.findByText("No score yet")).toBeInTheDocument();
      expect(view.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});

vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleUnauthorized: vi.fn(),
}));
