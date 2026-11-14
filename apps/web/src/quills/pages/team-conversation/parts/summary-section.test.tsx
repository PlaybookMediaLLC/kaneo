import type { ReactElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { requestConversationSummaryFixture } from "../../../api/team/request-conversation-summary.fixture";
import { press } from "../../../test/actions";
import { SummarySection } from "./summary-section";

const team = {
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "user_test_1" },
  permissions: {
    read: true,
    create: true,
    update: true,
    delete: true,
    manageSettings: true,
  },
};
const render = (element: ReactElement) =>
  renderComponent(
    <TeamRuntimeProvider value={team}>{element}</TeamRuntimeProvider>,
  );

describe("SummarySection", () => {
  it("shows the summary and asks for a new one", async () => {
    const api = mockApi();
    api.reply(requestConversationSummaryFixture.ok());
    const view = render(
      <SummarySection
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        summary="The export fails on large files."
      />,
    );
    expect(
      view.getByText("The export fails on large files."),
    ).toBeInTheDocument();
    press("Summarize again");
    expect(await view.findByText(/on its way/)).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: "Summarize again" }),
    ).toBeDisabled();
    expect(api.calls("requestQuillsConversationSummary")).toHaveLength(1);
  });

  it("says that AI is off when the workspace has no AI", async () => {
    const api = mockApi();
    const off = requestConversationSummaryFixture.problem(409);
    api.reply(off.body, off.status);
    const view = render(
      <SummarySection
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        summary={null}
      />,
    );
    press("Summarize");
    expect(
      await view.findByText("AI is off for this workspace."),
    ).toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Summarize" }),
    ).not.toBeInTheDocument();
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });
});
