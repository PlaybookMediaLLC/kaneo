import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { handleUnauthorized } from "../ui/upstream";
import { TeamStateView } from "./team-state-view";

vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleUnauthorized: vi.fn(),
}));

describe("TeamStateView", () => {
  beforeEach(() => vi.mocked(handleUnauthorized).mockClear());

  it("shows the denied state for a 403 and hides the content", () => {
    const view = renderComponent(
      <TeamStateView problem={{ kind: "noAccess" }}>
        <p>Private data</p>
      </TeamStateView>,
    );
    expect(view.getByRole("alert")).toHaveTextContent(/permission/i);
    expect(view.queryByText("Private data")).not.toBeInTheDocument();
    expect(handleUnauthorized).not.toHaveBeenCalled();
  });

  it("starts the sign-in redirect once for a 401", () => {
    const view = renderComponent(
      <TeamStateView problem={{ kind: "authRequired" }}>
        <p>Private data</p>
      </TeamStateView>,
    );
    view.rerender(
      <TeamStateView problem={{ kind: "authRequired" }}>
        <p>Private data</p>
      </TeamStateView>,
    );
    expect(handleUnauthorized).toHaveBeenCalledOnce();
    expect(view.queryByText("Private data")).not.toBeInTheDocument();
  });

  it("keeps the loading state before a denial and shows content when ready", () => {
    const view = renderComponent(
      <TeamStateView loading problem={{ kind: "noAccess" }}>
        <p>Team data</p>
      </TeamStateView>,
    );
    expect(view.getByText(/loading/i)).toBeInTheDocument();
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    view.rerender(
      <TeamStateView problem={null}>
        <p>Team data</p>
      </TeamStateView>,
    );
    expect(view.getByText("Team data")).toBeInTheDocument();
  });
});
