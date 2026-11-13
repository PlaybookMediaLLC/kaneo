import {
  act,
  fireEvent,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import type { ComponentType } from "react";
import type {
  PageMeta,
  PortalProblem,
  PortalProblemKind,
  Viewer,
} from "../core/types";
import { renderPage, renderQuillsHook, type RenderPageOptions } from "./render";
import { mockApi } from "./mock-api";

type RequestShape = {
  query?: Record<string, unknown>;
  json?: unknown;
};

const problemForStatus = (
  operationId: string,
  status: number,
): PortalProblemKind => {
  if (status === 400 || status === 422) return "invalid";
  if (status === 401) return "authRequired";
  if (status === 403) return "notFound";
  if (status === 404)
    return /Token|Csat/i.test(operationId) ? "gone" : "notFound";
  if (status === 409) return "conflict";
  if (status === 410) return "gone";
  if (status === 429) return "rateLimited";
  return "failed";
};

export function describeOperationContract(input: {
  operationId: string;
  operation: (request: never) => Promise<unknown>;
  request: unknown;
  response: unknown;
  method: string;
  path: string;
  statuses: number[];
  statusProblems?: Partial<Record<number, PortalProblemKind>>;
}) {
  it("sends the documented method, path and input", async () => {
    const api = mockApi();
    api.reply(input.response);
    await expect(input.operation(input.request as never)).resolves.toEqual(
      input.response,
    );
    expect(api.calls()).toHaveLength(1);
    const request = api.calls()[0];
    const url = new URL(request.url);
    const expected = input.request as RequestShape;
    expect(request.method).toBe(input.method.toUpperCase());
    expect(url.pathname).toBe(input.path);
    expect(Object.fromEntries(url.searchParams)).toEqual(
      Object.fromEntries(
        Object.entries(expected.query ?? {})
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      ),
    );
    expect(request.credentials).toBe("include");
    if (expected.json !== undefined)
      await expect(request.clone().json()).resolves.toEqual(expected.json);
    else expect(await request.clone().text()).toBe("");
  });
  for (const status of input.statuses)
    it(`maps the documented ${status} response`, async () => {
      const api = mockApi();
      api.reply(
        status === 400 || status === 422
          ? {
              code: "VALIDATION_ERROR",
              message: "Request could not be completed",
              issues: [{ path: "field", message: "Invalid field" }],
            }
          : { message: "Request could not be completed" },
        status,
      );
      await expect(
        input.operation(input.request as never),
      ).rejects.toMatchObject({
        kind:
          input.statusProblems?.[status] ??
          problemForStatus(input.operationId, status),
      });
    });
  it("maps a network failure", async () => {
    const api = mockApi();
    api.fail();
    await expect(input.operation(input.request as never)).rejects.toEqual({
      kind: "failed",
    });
  });
}

interface HookResult {
  data?: unknown;
  error: PortalProblem | null;
  fetchNextPage?: () => Promise<unknown>;
  fetchStatus?: string;
  isError: boolean;
  isSuccess: boolean;
  mutateAsync?: (request: unknown) => Promise<unknown>;
}

export function describeHookContract(input: {
  kind: "query" | "mutation";
  hook: unknown;
  operationId: string;
  request: unknown;
  emptyRequest?: unknown;
  response: unknown;
  viewer: Viewer;
  takesViewer?: boolean;
  invalidates?: readonly (readonly unknown[])[];
  paged?: { cursor: string | number };
  pollMs?: number;
  optimistic?: {
    queryKey: readonly unknown[];
    before: unknown;
    after: unknown;
  };
}) {
  const hook = input.hook as (...args: unknown[]) => HookResult;
  const renderContractHook = (request = input.request) =>
    renderQuillsHook(
      ({ currentRequest }: { currentRequest: unknown }) =>
        input.kind === "query"
          ? hook(currentRequest, input.viewer)
          : hook(...(input.takesViewer ? [input.viewer] : [])),
      { initialProps: { currentRequest: request } },
    );

  if (input.kind === "query") {
    it("returns data with a workspace-and-viewer-scoped query", async () => {
      const api = mockApi();
      api.reply(input.response);
      const view = renderContractHook();
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(api.calls(input.operationId)).toHaveLength(1);
      const key = JSON.stringify(
        view.queryClient.getQueryCache().getAll()[0]?.queryKey,
      );
      const workspace = (input.request as { param?: { workspace?: string } })
        .param?.workspace;
      if (workspace) expect(key).toContain(workspace);
      expect(key).toContain(
        input.viewer.kind === "user" ? input.viewer.id : "anonymous",
      );
    });
    if (input.emptyRequest)
      it("does not run while required input is empty", () => {
        const view = renderContractHook(input.emptyRequest);
        expect(view.result.current.fetchStatus).toBe("idle");
      });
    it("returns the mapped problem after a query failure", async () => {
      const api = mockApi();
      api.fail();
      const view = renderContractHook();
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(view.result.current.error).toEqual({ kind: "failed" });
    });
    if (input.paged)
      it("requests the declared next page only after the user asks", async () => {
        const api = mockApi();
        const nextKey =
          typeof input.paged!.cursor === "number" ? "nextOffset" : "nextCursor";
        api.reply({
          ...(input.response as object),
          [nextKey]: input.paged!.cursor,
        });
        api.reply(input.response);
        const view = renderContractHook();
        await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
        expect(api.calls(input.operationId)).toHaveLength(1);
        await act(() => view.result.current.fetchNextPage!());
        expect(api.calls(input.operationId)).toHaveLength(2);
        const secondUrl = new URL(api.calls(input.operationId)[1].url);
        expect(
          secondUrl.searchParams.get(
            nextKey === "nextOffset" ? "offset" : "cursor",
          ),
        ).toBe(String(input.paged!.cursor));
        await act(() => view.result.current.fetchNextPage!());
        expect(api.calls(input.operationId)).toHaveLength(2);
      });
    if (input.pollMs)
      it("uses the declared visible-tab polling interval", () => {
        const view = renderContractHook();
        const query = view.queryClient.getQueryCache().getAll()[0];
        expect(
          (query?.options as { refetchInterval?: number } | undefined)
            ?.refetchInterval,
        ).toBe(input.pollMs);
        expect(
          (
            query?.options as
              | { refetchIntervalInBackground?: boolean }
              | undefined
          )?.refetchIntervalInBackground,
        ).not.toBe(true);
        expect(input.pollMs).toBeGreaterThanOrEqual(10_000);
      });
    return;
  }

  it("invalidates declared operations only after mutation success", async () => {
    const api = mockApi();
    let resolveRequest!: (body: unknown) => void;
    api.defer(({ resolve }) => {
      resolveRequest = resolve;
    });
    const view = renderContractHook();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = view.result.current.mutateAsync!(input.request);
    });
    await waitFor(() => expect(api.calls(input.operationId)).toHaveLength(1));
    expect(invalidate).not.toHaveBeenCalled();
    resolveRequest(input.response);
    await act(() => mutation);
    expect(api.calls(input.operationId)).toHaveLength(1);
    for (const queryKey of input.invalidates ?? [])
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });
  it("returns the problem and invalidates nothing after mutation failure", async () => {
    const api = mockApi();
    api.fail();
    const view = renderContractHook();
    const invalidate = vi.spyOn(view.queryClient, "invalidateQueries");
    await act(async () => {
      await expect(
        view.result.current.mutateAsync!(input.request),
      ).rejects.toEqual({ kind: "failed" });
    });
    expect(invalidate).not.toHaveBeenCalled();
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.error).toEqual({ kind: "failed" });
  });
  if (input.optimistic)
    it("applies the optimistic value and restores it after failure", async () => {
      const api = mockApi();
      let rejectRequest!: (error: Error) => void;
      api.defer(({ reject }) => {
        rejectRequest = reject;
      });
      const view = renderContractHook();
      view.queryClient.setQueryData(
        input.optimistic!.queryKey,
        input.optimistic!.before,
      );
      let mutation!: Promise<unknown>;
      act(() => {
        mutation = view.result.current.mutateAsync!(input.request);
      });
      await waitFor(() =>
        expect(
          view.queryClient.getQueryData(input.optimistic!.queryKey),
        ).toEqual(input.optimistic!.after),
      );
      rejectRequest(new Error("Network unavailable"));
      await expect(mutation).rejects.toEqual({ kind: "failed" });
      expect(view.queryClient.getQueryData(input.optimistic!.queryKey)).toEqual(
        input.optimistic!.before,
      );
    });
}

export interface PageContractCase {
  prepare: () => RenderPageOptions | void;
  act?: (view: ReturnType<typeof renderPage>) => void | Promise<void>;
  assert?: (view: ReturnType<typeof renderPage>) => void | Promise<void>;
}

async function assertPageState(
  state: string,
  view: ReturnType<typeof renderPage>,
) {
  if (state === "loading") {
    await waitFor(() => {
      const statuses = view.getAllByRole("status");
      expect(
        statuses.some((status) =>
          /loading/i.test(
            `${status.textContent ?? ""} ${status.getAttribute("aria-label") ?? ""}`,
          ),
        ),
      ).toBe(true);
    });
    return;
  }
  if (state === "empty") {
    await waitFor(() =>
      expect(view.getByRole("status")).toHaveTextContent(/nothing|empty/i),
    );
    return;
  }
  if (
    [
      "authRequired",
      "conflict",
      "failed",
      "gone",
      "noAccess",
      "notFound",
      "rateLimited",
    ].includes(state)
  ) {
    await waitFor(() => expect(view.getByRole("alert")).toBeInTheDocument());
    if (state === "rateLimited") {
      expect(view.getByRole("button", { name: /try again/i })).toBeDisabled();
    }
    return;
  }
  await waitFor(() =>
    expect(view.queryByText(/^loading/i)).not.toBeInTheDocument(),
  );
  expect(view.queryByRole("alert")).not.toBeInTheDocument();
}

export function describePageContract(
  meta: PageMeta,
  Page: ComponentType<{
    workspaceId: string;
    params: Record<string, string>;
    search: Record<string, unknown>;
  }>,
  cases?: Record<string, PageContractCase>,
) {
  it("sets the title, renders one heading and moves focus to it", async () => {
    const options = cases?.ready?.prepare() ?? {};
    renderPage(Page, meta, options);
    await waitFor(() =>
      expect(document.querySelectorAll("h1")).toHaveLength(1),
    );
    await waitFor(() => expect(document.querySelector("h1")).toHaveFocus());
    expect(document.title).not.toBe("");
  });
  if (meta.audience !== "public" && meta.audience !== "development")
    it("does not expose page data without audience access", () => {
      const api = mockApi();
      renderPage(Page, meta, { accessGranted: false });
      expect(api.calls()).toHaveLength(0);
    });
  if (meta.audience === "portal" || meta.audience === "signed-in")
    it("asks an anonymous denied visitor to sign in and returns to the same page", async () => {
      const api = mockApi();
      const view = renderPage(Page, meta, { accessGranted: false });
      const signIn = await view.findByRole("link", { name: /sign in/i });
      const href = signIn.getAttribute("href") ?? "";
      const redirect = new URL(href, "http://portal.test").searchParams.get(
        "redirect",
      );
      expect(redirect?.replace(/\/$/, "")).toBe(
        view.router.state.location.pathname.replace(/\/$/, ""),
      );
      expect(redirect).toMatch(/^\/(?!\/)/);
      expect(api.calls()).toHaveLength(0);
    });
  if (!cases) return;
  for (const state of meta.states) {
    const contractCase = cases[state];
    it(`renders the ${state} state`, async () => {
      expect(contractCase, `Missing contract case for ${state}`).toBeDefined();
      if (!contractCase) return;
      const view = renderPage(Page, meta, contractCase.prepare() ?? {});
      await contractCase.act?.(view);
      await assertPageState(state, view);
      await contractCase.assert?.(view);
    });
  }
}

export function describeFormContract<TValues>(input: {
  render: (
    onSubmit: (values: TValues) => Promise<PortalProblem | void>,
  ) => RenderResult;
  fieldName: string | RegExp;
  issuePath: string;
  submitName: string | RegExp;
  validValue: string;
  expectedValues: NoInfer<TValues>;
  invalidValue?: string;
}) {
  const complete = (view: RenderResult) => {
    fireEvent.change(view.getByLabelText(input.fieldName), {
      target: { value: input.validValue },
    });
  };
  it("renders a labelled field and submits valid values only once", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = input.render(onSubmit);
    complete(view);
    const submit = view.getByRole("button", { name: input.submitName });
    const form = submit.closest("form")!;
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(input.expectedValues);
    finish();
  });
  if (input.invalidValue !== undefined)
    it("blocks client-invalid values", async () => {
      const onSubmit = vi.fn(async () => undefined);
      const view = input.render(onSubmit);
      fireEvent.change(view.getByLabelText(input.fieldName), {
        target: { value: input.invalidValue },
      });
      fireEvent.click(view.getByRole("button", { name: input.submitName }));
      await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    });
  it("maps API field issues and keeps the draft", async () => {
    const onSubmit = vi.fn(async () => ({
      kind: "invalid" as const,
      issues: [{ path: input.issuePath, message: "Server field issue" }],
    }));
    const view = input.render(onSubmit);
    complete(view);
    fireEvent.click(view.getByRole("button", { name: input.submitName }));
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Server field issue",
    );
    expect(view.getByLabelText(input.fieldName)).toHaveValue(input.validValue);
  });
  it("keeps the draft after a retryable failure and requires an explicit reset", async () => {
    const onSubmit = vi.fn(async () => ({ kind: "failed" as const }));
    const view = input.render(onSubmit);
    complete(view);
    fireEvent.click(view.getByRole("button", { name: input.submitName }));
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(view.getByLabelText(input.fieldName)).toHaveValue(input.validValue);
    fireEvent.click(view.getByRole("button", { name: /try again/i }));
    expect(view.getByLabelText(input.fieldName)).toHaveValue(input.validValue);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it("refuses submission inside a frame", async () => {
    vi.stubGlobal("top", {});
    const onSubmit = vi.fn(async () => undefined);
    const view = input.render(onSubmit);
    complete(view);
    fireEvent.click(view.getByRole("button", { name: input.submitName }));
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
}

export function describeRedirectContract(input: {
  Route: unknown;
  params: Record<string, string>;
  expectedTo: string;
}) {
  it("throws the declared router redirect with the original params", () => {
    const route = input.Route as {
      options: { beforeLoad?: (context: unknown) => unknown };
    };
    expect(() => route.options.beforeLoad?.({ params: input.params })).toThrow(
      expect.objectContaining({
        options: expect.objectContaining({
          to: input.expectedTo,
          params: input.params,
        }),
      }),
    );
  });
}

export function describeRouteContract(
  input:
    | {
        Route: unknown;
        validSearch?: Record<string, unknown>;
        expectedSearch?: unknown;
      }
    | unknown,
) {
  const supplied = input as Record<string, unknown>;
  const contract =
    "Route" in supplied
      ? (supplied as {
          Route: unknown;
          validSearch?: Record<string, unknown>;
          expectedSearch?: unknown;
        })
      : { Route: input };
  it("renders a page component and validates route search", () => {
    const route = contract.Route as {
      options: { component?: unknown; validateSearch?: unknown };
    };
    expect(route.options.component).toBeTypeOf("function");
    const validator = route.options.validateSearch;
    if (!validator) return;
    const parsed =
      typeof validator === "function"
        ? validator(contract.validSearch ?? {})
        : (validator as { parse: (value: unknown) => unknown }).parse(
            contract.validSearch ?? {},
          );
    expect(parsed).toEqual(
      contract.expectedSearch ?? contract.validSearch ?? {},
    );
  });
}
