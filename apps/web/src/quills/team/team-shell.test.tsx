import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { TeamRuntimeProvider } from "./runtime";
import { TeamShell } from "./team-shell";

vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

function renderShell(path: string, content = <p>Page content</p>) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
      <TeamRuntimeProvider
        value={{
          workspaceId: "workspace_1",
          viewer: { kind: "user", id: "user_1" },
          permissions: {
            read: true,
            create: true,
            update: true,
            delete: true,
            manageSettings: true,
          },
        }}
      >
        <TeamShell workspaceId="workspace_1" workspaceName="Acme">
          {content}
        </TeamShell>
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
}

describe("TeamShell", () => {
  it("shows the rail, the views of the current section with counts and the page", async () => {
    const api = mockApi();
    api.reply(getTeamCountsFixture.ok({ pendingDuplicates: 2 }));
    const view = renderShell("/feedback/workspace_1/duplicates");
    expect(
      view.getByRole("navigation", { name: "App sections" }),
    ).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "data-active",
      "true",
    );
    const views = view.getByRole("navigation", { name: "Feedback views" });
    const duplicates = await view.findByRole("link", { name: "Duplicates 2" });
    expect(views).toContainElement(duplicates);
    expect(duplicates).toHaveAttribute("aria-current", "page");
    expect(view.getByText("Acme")).toBeVisible();
    expect(view.getByRole("main")).toHaveTextContent("Page content");
    expect(api.calls("getQuillsTeamCounts")).toHaveLength(1);
  });

  it("follows the section of the current view, also on a sub-path", async () => {
    const api = mockApi();
    api.reply(getTeamCountsFixture.ok());
    const view = renderShell("/feedback/workspace_1/surveys/survey_1");
    expect(
      view.getByRole("navigation", { name: "Insights views" }),
    ).toBeInTheDocument();
    expect(await view.findByRole("link", { name: "Surveys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the views without counts when the counts request fails", async () => {
    const api = mockApi();
    api.reply(getTeamCountsFixture.problem(403).body, 403);
    const view = renderShell("/feedback/workspace_1");
    await waitFor(() =>
      expect(
        view.queryClient.getQueryCache().findAll({ queryKey: ["quills"] })[0]
          ?.state.status,
      ).toBe("error"),
    );
    expect(view.getByRole("link", { name: "Duplicates" })).toBeVisible();
  });

  it("opens the views in a sheet on small screens", async () => {
    const api = mockApi();
    api.reply(getTeamCountsFixture.ok());
    const view = renderShell("/feedback/workspace_1/insights");
    press("Views");
    const sheet = await view.findByRole("dialog", { name: "Insights" });
    expect(sheet).toHaveTextContent("Surveys");
  });
});
