import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { createSurveyFixture } from "../../api/team/create-survey.fixture";
import { listSurveysFixture } from "../../api/team/list-surveys.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderComponent, renderPage } from "../../test/render";
import { ShortcutListener } from "../../ui/upstream";
import { meta } from "./meta";
import { TeamSurveysPage } from "./team-surveys-page";

const survey = {
  id: "survey_test_1",
  type: "nps" as const,
  question: "How likely are you to recommend us?",
  options: [],
  targetSegmentIds: null,
  status: "active" as const,
  responseCount: 3,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("TeamSurveysPage", () => {
  describePageContract(meta, TeamSurveysPage, {
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
        api.reply(listSurveysFixture.ok());
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(listSurveysFixture.ok({ surveys: [survey] }));
      },
    },
  });

  describe("behavior", () => {
    it("lists each survey with its status and response count", async () => {
      const api = mockApi();
      api.reply(listSurveysFixture.ok({ surveys: [survey] }));
      const view = renderPage(TeamSurveysPage, meta);
      const link = await view.findByRole("link", {
        name: /How likely are you to recommend us\?/,
      });
      expect(link).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/surveys/survey_test_1",
      );
      expect(link).toHaveTextContent("Net Promoter Score (0 to 10)");
      expect(link).toHaveTextContent("3 responses");
      expect(view.getByRole("group", { name: "Active 1" })).toContainElement(
        link,
      );
    });

    it("moves through the surveys by key and opens one with Enter", async () => {
      const api = mockApi();
      api.reply(
        listSurveysFixture.ok({
          surveys: [
            survey,
            {
              ...survey,
              id: "survey_test_2",
              question: "Which plan?",
              status: "draft",
            },
          ],
        }),
      );
      renderComponent(<ShortcutListener />);
      const view = renderPage(TeamSurveysPage, meta);
      await view.findByRole("link", { name: /Which plan\?/ });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" });
      expect(view.getByRole("link", { name: /Which plan\?/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      fireEvent.keyDown(document.body, { key: "Enter" });
      await waitFor(() =>
        expect(view.router.state.location.pathname).toBe(
          "/feedback/workspace_test_1/surveys/survey_test_2",
        ),
      );
    });

    it("creates a draft in the sheet and refreshes the list", async () => {
      const api = mockApi();
      api.reply(listSurveysFixture.ok());
      api.reply(createSurveyFixture.ok());
      api.reply(listSurveysFixture.ok({ surveys: [survey] }));
      const view = renderPage(TeamSurveysPage, meta);
      expect(await view.findByText("No surveys yet.")).toBeInTheDocument();
      press("New survey");
      await view.findByLabelText("Question");
      fill("Question", "How likely?");
      press("Create draft");
      await waitFor(() =>
        expect(api.calls("createQuillsSurvey")).toHaveLength(1),
      );
      expect(await api.calls("createQuillsSurvey")[0]!.json()).toEqual({
        type: "nps",
        question: "How likely?",
      });
      expect(
        await view.findByRole("link", {
          name: /How likely are you to recommend us\?/,
        }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(view.queryByLabelText("Question")).not.toBeInTheDocument(),
      );
    });

    it("hides the create action without the create permission", async () => {
      const api = mockApi();
      api.reply(listSurveysFixture.ok());
      const view = renderPage(TeamSurveysPage, meta, {
        permissions: { create: false },
      });
      expect(await view.findByText("No surveys yet.")).toBeInTheDocument();
      expect(
        view.queryByRole("button", { name: "New survey" }),
      ).not.toBeInTheDocument();
    });

    it("starts the sign-in redirect when the session ends", async () => {
      const { handleUnauthorized } = await import("../../ui/upstream");
      const api = mockApi();
      api.reply({ message: "Unauthorized" }, 401);
      renderPage(TeamSurveysPage, meta);
      await vi.waitFor(() => expect(handleUnauthorized).toHaveBeenCalled());
    });
  });
});

vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleUnauthorized: vi.fn(),
}));
