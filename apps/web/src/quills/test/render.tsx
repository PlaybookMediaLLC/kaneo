import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  render,
  renderHook,
  type RenderHookOptions,
} from "@testing-library/react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach } from "vite-plus/test";
import type { PageMeta, Viewer } from "../core/types";
import { ensureQuillsI18n } from "../i18n/load";
import {
  PortalRuntimeProvider,
  type PortalRuntimeValue,
} from "../portal/runtime";
import { i18n } from "../ui/upstream";

afterEach(() => cleanup());

function Providers({
  children,
  client,
}: {
  children: ReactNode;
  client: QueryClient;
}) {
  void ensureQuillsI18n();
  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

export function createQuillsTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function renderComponent(element: ReactElement) {
  const client = createQuillsTestQueryClient();
  return render(element, {
    wrapper: ({ children }) => (
      <Providers client={client}>{children}</Providers>
    ),
  });
}

export interface RenderPageOptions {
  workspaceId?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  viewer?: Viewer;
  accessGranted?: boolean;
  accessLoading?: boolean;
  accessProblem?: PortalRuntimeValue["accessProblem"];
  retryAccess?: () => void;
}

export function renderPage(
  Page: ComponentType<{
    workspaceId: string;
    params: Record<string, string>;
    search: Record<string, unknown>;
  }>,
  meta: PageMeta,
  options: RenderPageOptions = {},
) {
  const workspaceId = options.workspaceId ?? "workspace_test_1";
  const viewer = options.viewer ?? { kind: "anonymous" };
  const runtime: PortalRuntimeValue = {
    config: {
      name: "Test workspace",
      features: {
        allowAnonymous: true,
        allowEditAfterEngagement: false,
        allowDeleteAfterEngagement: false,
        showPublicEditHistory: false,
      },
      portalAccess: { isPrivate: false },
      branding: {
        logoUrl: null,
        theme: { themeMode: "user", light: {}, dark: {} },
        headerDisplayMode: "logo_and_name",
        headerDisplayName: null,
      },
    },
    viewer,
    access: {
      granted: options.accessGranted ?? true,
      reason: options.accessGranted === false ? "unauthorized" : "public",
    },
    accessLoading: options.accessLoading ?? false,
    accessProblem: options.accessProblem ?? null,
    retryAccess: options.retryAccess,
  };
  const routeParams: Record<string, string> = {
    workspaceId,
    ...options.params,
  };
  const initialPath = meta.route
    .replace("$workspaceId", workspaceId)
    .replace(/\$([A-Za-z]+)/g, (_, name: string) => {
      routeParams[name] ??= `${name}_test_1`;
      return routeParams[name];
    });
  const rootRoute = createRootRoute();
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const client = createQuillsTestQueryClient();
  const result = render(
    <Providers client={client}>
      <RouterContextProvider router={router}>
        <PortalRuntimeProvider value={runtime}>
          <Page
            workspaceId={workspaceId}
            params={routeParams}
            search={options.search ?? {}}
          />
        </PortalRuntimeProvider>
      </RouterContextProvider>
    </Providers>,
  );
  return Object.assign(result, { queryClient: client, router });
}

export function renderQuillsHook<Result, Props>(
  hook: (props: Props) => Result,
  options: RenderHookOptions<Props>,
) {
  const queryClient = createQuillsTestQueryClient();
  const result = renderHook(hook, {
    ...options,
    wrapper: ({ children }) => (
      <Providers client={queryClient}>{children}</Providers>
    ),
  });
  return Object.assign(result, { queryClient });
}
