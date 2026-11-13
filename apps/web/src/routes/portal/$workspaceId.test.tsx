import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";
import { evaluateMyPortalAccessFixture } from "@/quills/api/portal/evaluate-my-portal-access.fixture";
import { getPublicPortalConfigFixture } from "@/quills/api/portal/get-public-portal-config.fixture";
import { PortalRoute } from "@/quills/portal/layout";
import { mockApi } from "@/quills/test/mock-api";
import { i18n } from "@/quills/ui/upstream";
import { Route } from "./$workspaceId";

describe("portal layout route", () => {
  it("loads translations and resolves portal access before child routes", async () => {
    const api = mockApi();
    api.reply(getPublicPortalConfigFixture.ok());
    api.reply(evaluateMyPortalAccessFixture.ok({ granted: true }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const beforeLoad = Route.options.beforeLoad;

    const result = await beforeLoad?.({
      context: { queryClient, user: null },
      params: { workspaceId: "workspace_test_1" },
    } as never);

    expect(i18n.hasResourceBundle("en-US", "quills")).toBe(true);
    expect(result?.quillsPortal).toMatchObject({
      workspaceId: "workspace_test_1",
      viewer: { kind: "anonymous" },
      portalAvailable: true,
      accessGranted: true,
    });
    expect(Route.options.component).toBe(PortalRoute);
  });
});
