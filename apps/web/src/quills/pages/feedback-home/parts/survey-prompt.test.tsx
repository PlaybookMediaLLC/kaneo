import { afterEach, describe, expect, it } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { getPortalActiveSurveyFixture } from "../../../api/feedback/get-portal-active-survey.fixture";
import { submitPortalSurveyResponseFixture } from "../../../api/feedback/submit-portal-survey-response.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { SurveyPrompt } from "./survey-prompt";

const user = { kind: "user" as const, id: "account_test_1" };
const survey = {
  id: "survey_test_1",
  type: "csat" as const,
  question: "How was your week with us?",
  options: [],
  scale: { min: 1, max: 5 },
};

afterEach(() => sessionStorage.clear());

describe("SurveyPrompt", () => {
  it("asks nothing of an anonymous visitor", () => {
    const api = mockApi();
    const view = renderComponent(
      <SurveyPrompt
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
      />,
    );
    expect(view.container).toBeEmptyDOMElement();
    expect(api.calls()).toHaveLength(0);
  });

  it("sends the answer once and thanks the customer", async () => {
    const api = mockApi();
    api.reply(getPortalActiveSurveyFixture.ok({ survey }));
    api.reply(submitPortalSurveyResponseFixture.ok({ surveyId: survey.id }));
    api.reply(getPortalActiveSurveyFixture.ok());
    const view = renderComponent(
      <SurveyPrompt workspaceId="workspace_test_1" viewer={user} />,
    );
    fireEvent.click(await view.findByRole("radio", { name: "4" }));
    press("Send answer");
    expect(await view.findByText("Thanks for your answer")).toHaveAttribute(
      "role",
      "status",
    );
    const sent = api.calls("submitQuillsPortalSurveyResponse");
    expect(sent).toHaveLength(1);
    expect(await sent[0]!.json()).toEqual({ score: 4 });
    expect(new URL(sent[0]!.url).pathname).toBe(
      "/api/quills-public/workspace_test_1/portal/surveys/survey_test_1/responses",
    );
  });

  it("thanks the customer who already answered in another tab", async () => {
    const api = mockApi();
    api.reply(getPortalActiveSurveyFixture.ok({ survey }));
    api.reply({ message: "You already answered this survey" }, 409);
    const view = renderComponent(
      <SurveyPrompt workspaceId="workspace_test_1" viewer={user} />,
    );
    fireEvent.click(await view.findByRole("radio", { name: "5" }));
    press("Send answer");
    expect(await view.findByText("Thanks for your answer")).toBeVisible();
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed answer and keeps the choice", async () => {
    const api = mockApi();
    api.reply(getPortalActiveSurveyFixture.ok({ survey }));
    api.reply({ message: "Server error" }, 500);
    const view = renderComponent(
      <SurveyPrompt workspaceId="workspace_test_1" viewer={user} />,
    );
    fireEvent.click(await view.findByRole("radio", { name: "2" }));
    press("Send answer");
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(view.getByRole("radio", { name: "2" })).toBeChecked();
  });

  it("hides a dismissed survey for the rest of the session", async () => {
    const api = mockApi();
    api.reply(getPortalActiveSurveyFixture.ok({ survey }));
    const view = renderComponent(
      <SurveyPrompt workspaceId="workspace_test_1" viewer={user} />,
    );
    await view.findByRole("heading", { name: survey.question });
    press("Not now");
    await waitFor(() =>
      expect(view.queryByRole("heading")).not.toBeInTheDocument(),
    );
    view.unmount();
    api.reply(getPortalActiveSurveyFixture.ok({ survey }));
    const again = renderComponent(
      <SurveyPrompt workspaceId="workspace_test_1" viewer={user} />,
    );
    await waitFor(() => expect(api.calls()).toHaveLength(2));
    await waitFor(() => expect(again.queryClient.isFetching()).toBe(0));
    expect(
      again.queryClient.getQueryCache().getAll()[0]?.state.data,
    ).toMatchObject({ survey: { id: survey.id } });
    expect(again.queryByRole("heading")).not.toBeInTheDocument();
  });
});
