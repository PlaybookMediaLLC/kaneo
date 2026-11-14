import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { Route } from "./$";

const redirectOld = Route.options.beforeLoad as unknown as (context: {
  location: { pathname: string; searchStr: string; hash: string };
}) => void;

// The real router follows the redirect, so the test proves the matching and the target.
async function follow(path: string) {
  const root = createRootRoute();
  const legacy = createRoute({
    getParentRoute: () => root,
    path: "/dashboard/workspace/$workspaceId/quills/$",
    beforeLoad: ({ location }) => redirectOld({ location }),
  });
  const app = createRoute({
    getParentRoute: () => root,
    path: "/feedback/$",
  });
  const router = createRouter({
    routeTree: root.addChildren([legacy, app]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state.location.href;
}

describe("old teammate addresses", () => {
  it("redirect to the teammate app with the same sub-path and search", async () => {
    expect(
      await follow(
        "/dashboard/workspace/workspace_1/quills/surveys/survey_1?tab=results",
      ),
    ).toBe("/feedback/workspace_1/surveys/survey_1?tab=results");
  });

  it("redirect the old overview address", async () => {
    expect(await follow("/dashboard/workspace/workspace_1/quills")).toBe(
      "/feedback/workspace_1",
    );
    expect(await follow("/dashboard/workspace/workspace_1/quills/")).toBe(
      "/feedback/workspace_1",
    );
  });
});
