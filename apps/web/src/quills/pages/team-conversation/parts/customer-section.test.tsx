import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { getUserCompanyFixture } from "../../../api/team/get-user-company.fixture";
import { getUserFixture } from "../../../api/team/get-user.fixture";
import { CustomerSection } from "./customer-section";

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

describe("CustomerSection", () => {
  it("shows the customer's profile and company", async () => {
    const api = mockApi();
    api.reply(
      getUserFixture.ok({
        name: "Grace Customer",
        email: "grace@example.test",
        companyId: "company_test_1",
        segments: [{ id: "s1", name: "Beta", color: "gray", type: "manual" }],
      }),
    );
    api.reply(
      getUserCompanyFixture.ok({
        company: {
          id: "company_test_1",
          name: "Acme",
          domain: null,
          externalId: null,
          plan: "Pro",
          mrrCents: 120000,
          size: null,
          website: null,
          industry: null,
          source: "manual",
          attributes: [],
          memberCount: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    const view = render(
      <CustomerSection
        workspaceId="workspace_test_1"
        principalId="principal_test_9"
        name={null}
        email={null}
      />,
    );
    expect(await view.findByText("Acme")).toBeInTheDocument();
    expect(view.getByText("Grace Customer")).toBeInTheDocument();
    expect(view.getByText("grace@example.test")).toBeInTheDocument();
    expect(view.getByText("Pro")).toBeInTheDocument();
    expect(view.getByText("1,200")).toBeInTheDocument();
    expect(view.getByText("Beta")).toBeInTheDocument();
  });

  it("falls back to the conversation's name and email without a profile", async () => {
    const api = mockApi();
    const missing = getUserFixture.problem(404);
    api.reply(missing.body, missing.status);
    const view = render(
      <CustomerSection
        workspaceId="workspace_test_1"
        principalId="principal_test_9"
        name="Visitor 12"
        email="v12@example.test"
      />,
    );
    await vi.waitFor(() => expect(api.calls()).toHaveLength(1));
    expect(view.getByText("Visitor 12")).toBeInTheDocument();
    expect(view.getByText("v12@example.test")).toBeInTheDocument();
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.calls("getQuillsUserCompany")).toHaveLength(0);
  });
});
