import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { RequestRow, type RequestRowProps } from "./request-row";

const row: RequestRowProps = {
  href: "/feedback/workspace_1/posts/post_1",
  onOpen: () => undefined,
  title: "Dark mode",
  icon: <svg aria-hidden="true" data-icon="status" />,
  badges: [{ id: "stale", label: "Stale 6mo", tone: "error" }],
  votes: 12,
  comments: 3,
  board: "Features",
  time: "2026-10-31T12:00:00.000Z",
  person: { name: "Ada Customer" },
};

describe("RequestRow", () => {
  it("shows the icon, title, badges, votes, comments, board, date and author", () => {
    const view = renderComponent(<RequestRow {...row} />);
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("href", row.href);
    expect(link.querySelector("[data-icon=status]")).toBeInTheDocument();
    for (const text of [
      "Dark mode",
      "Stale 6mo",
      "12 votes",
      "3 comments",
      "Features",
      "Oct 31",
      "Ada Customer",
    ])
      expect(link).toHaveTextContent(text);
  });

  it("shows a plain detail line and leaves out the counts it has not got", () => {
    const view = renderComponent(
      <RequestRow
        href="/feedback/workspace_1/surveys/survey_1"
        onOpen={() => undefined}
        title="How likely are you to recommend us?"
        detail="4 responses"
        time="2026-10-31T12:00:00.000Z"
      />,
    );
    const link = view.getByRole("link");
    expect(link).toHaveTextContent("4 responses");
    expect(link).not.toHaveTextContent(/votes|comments/);
  });

  it("stacks the card in the list pane and opens on a plain click", () => {
    const onOpen = vi.fn();
    const view = renderComponent(
      <RequestRow {...row} compact selected onOpen={onOpen} />,
    );
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("aria-current", "true");
    expect(link).toHaveTextContent("Ada Customer");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
