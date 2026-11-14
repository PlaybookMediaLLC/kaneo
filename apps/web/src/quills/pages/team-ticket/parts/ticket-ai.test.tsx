import { describe, expect, it } from "vite-plus/test";
import { getAssistantRunFixture } from "../../../api/team/get-assistant-run.fixture";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { getTicketSummaryFixture } from "../../../api/team/get-ticket-summary.fixture";
import { requestTicketSummaryFixture } from "../../../api/team/request-ticket-summary.fixture";
import { suggestTicketFieldValuesFixture } from "../../../api/team/suggest-ticket-field-values.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketAi } from "./ticket-ai";

const bug = {
  id: "ticket_type_bug",
  name: "Bug",
  slug: "bug",
  category: "customer" as const,
  icon: null,
  color: "gray",
};

function render(summary: string | null, update = true) {
  const api = mockApi();
  api.reply(getTicketSummaryFixture.ok({ ticketId: "ticket_test_1", summary }));
  const view = renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions: {
          read: true,
          create: true,
          update,
          delete: false,
          manageSettings: false,
        },
      }}
    >
      <TicketAi
        ticket={getTicketFixture.ok({ id: "ticket_test_1", ticketType: bug })}
      />
    </TeamRuntimeProvider>,
  );
  return { api, view };
}

describe("TicketAi", () => {
  it("shows the stored summary and asks for a new one", async () => {
    const { api, view } = render("The requester cannot sign in.");
    expect(
      await view.findByText("The requester cannot sign in."),
    ).toBeInTheDocument();
    api.reply(requestTicketSummaryFixture.ok());
    api.reply(getTicketSummaryFixture.ok({ summary: "Sign-in fails." }));
    press("Summarize");
    expect(
      await view.findByText("The summary is on its way."),
    ).toBeInTheDocument();
    expect(api.calls("requestQuillsTicketSummary")).toHaveLength(1);
  });

  it("says that AI is off when the API refuses the summary", async () => {
    const { api, view } = render(null);
    await view.findByText("No summary yet.");
    api.reply({ message: "AI is not configured" }, 409);
    press("Summarize");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "AI is not set up for this workspace.",
    );
  });

  it("shows the suggested field values of a finished run", async () => {
    const { api, view } = render(null, false);
    await view.findByText("No summary yet.");
    expect(view.queryByRole("button", { name: "Summarize" })).toBeNull();
    api.reply(suggestTicketFieldValuesFixture.ok({ id: "run_1" }));
    api.reply(
      getAssistantRunFixture.ok({
        id: "run_1",
        kind: "ticket_fields",
        status: "succeeded",
        output: {
          text: null,
          citations: [],
          proposedActionIds: [],
          values: [
            {
              key: "browser",
              value: "Firefox",
              reason: "Named in the first message.",
            },
          ],
        },
      }),
    );
    press("Suggest field values");
    expect(await view.findByText("Firefox")).toBeInTheDocument();
    expect(view.getByText("Named in the first message.")).toBeInTheDocument();
    const [run] = api.calls("getQuillsAssistantRun");
    expect(new URL(run!.url).pathname).toBe(
      "/api/quills/workspace_test_1/assistant/runs/run_1",
    );
  });
});
