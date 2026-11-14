import { describe, expect, it, vi } from "vite-plus/test";
import { setPostScoreFixture } from "../../../api/team/set-post-score.fixture";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { TriageTable, type TriageTableProps } from "./triage-table";

const post = {
  ...setPostScoreFixture.ok({
    id: "post_test_1",
    title: "Export history",
    voteCount: 3,
    score: { reach: 10, impact: 2, confidence: 50, effort: 2, rice: 5 },
  }),
  demand: {
    voters: 3,
    companies: 1,
    mrrCents: 25000,
    importance: { nice: 0, important: 1, critical: 2 },
  },
};
const props = (over: Partial<TriageTableProps> = {}): TriageTableProps => ({
  posts: [post],
  money: (cents) => `$${cents / 100}`,
  canScore: true,
  editingId: null,
  onEdit: vi.fn(),
  onScore: vi.fn(async () => undefined),
  ...over,
});

describe("TriageTable", () => {
  it("shows a request's votes, importance, companies, revenue and RICE", () => {
    const view = renderComponent(<TriageTable {...props()} />);
    const row = view.getByRole("row", { name: /export history/i });
    expect(row).toHaveTextContent("Export history30121$2505");
  });

  it("opens the inline score editor with the current inputs", () => {
    const onEdit = vi.fn();
    const view = renderComponent(<TriageTable {...props({ onEdit })} />);
    press(/score .export history/i);
    expect(onEdit).toHaveBeenCalledWith("post_test_1");
    view.rerender(
      <TriageTable {...props({ onEdit, editingId: "post_test_1" })} />,
    );
    expect(view.getByLabelText("Reach")).toHaveValue("10");
    expect(
      view.getByRole("button", { name: /score .export history/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the score without an editor when the teammate cannot update", () => {
    const view = renderComponent(
      <TriageTable {...props({ canScore: false, posts: [] })} />,
    );
    expect(view.getByText("No requests yet.")).toBeVisible();
    expect(view.queryByRole("button")).not.toBeInTheDocument();
  });
});
