import { describe, expect, it } from "vite-plus/test";
import { act } from "@testing-library/react";
import type { PageMeta } from "../core/types";
import { renderComponent, renderPage } from "./render";

const meta: PageMeta = {
  id: "testPage",
  feature: "test",
  route: "/portal/$workspaceId/test/$itemId",
  audience: "public",
  mailLinked: false,
  token: "none",
  operations: [],
  states: ["ready"],
};

describe("renderComponent", () => {
  it("renders with portal providers", () => {
    expect(renderComponent(<span />).container.firstChild).not.toBeNull();
  });

  it("starts each test with an isolated document", () => {
    expect(document.body).toBeEmptyDOMElement();
  });
});

describe("renderPage", () => {
  it("uses memory history and supplies route inputs", async () => {
    const view = renderPage(
      ({ workspaceId, params, search }) => (
        <output>
          {workspaceId}:{params.itemId}:{String(search.view)}
        </output>
      ),
      meta,
      { params: { itemId: "item_42" }, search: { view: "summary" } },
    );

    expect(
      await view.findByText("workspace_test_1:item_42:summary"),
    ).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe(
      "/portal/workspace_test_1/test/item_42",
    );

    await act(() => view.router.navigate({ to: "/next" }));
    expect(view.router.state.location.pathname).toBe("/next");
  });
});
