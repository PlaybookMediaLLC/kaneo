import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { DraftSheet } from "./draft-sheet";

const posts = [
  { id: "post_test_1", title: "Dark mode", voteCount: 4 },
  { id: "post_test_2", title: "CSV export", voteCount: 1 },
];

describe("DraftSheet", () => {
  it("drafts from the chosen shipped requests", async () => {
    const onDraft = vi.fn(async () => undefined);
    renderComponent(
      <DraftSheet
        posts={posts}
        draft={null}
        problem={null}
        onDraft={onDraft}
      />,
    );
    press("Draft from shipped requests");
    const submit = await screen.findByRole("button", { name: "Draft with AI" });
    expect(submit).toBeDisabled();
    (await screen.findByRole("checkbox", { name: /CSV export/ })).click();
    await vi.waitFor(() => expect(submit).toBeEnabled());
    submit.click();
    await vi.waitFor(() =>
      expect(onDraft).toHaveBeenCalledWith(["post_test_2"]),
    );
  });

  it("shows the draft for review with its requester count", async () => {
    renderComponent(
      <DraftSheet
        posts={posts}
        draft={{
          title: "Dark mode is here",
          body: "- Dark mode",
          requesterCount: 2,
        }}
        problem={null}
        onDraft={vi.fn()}
      />,
    );
    press("Draft from shipped requests");
    expect(
      await screen.findByRole("region", { name: "Draft for review" }),
    ).toHaveTextContent("Dark mode is here");
    expect(screen.getByText(/2 people asked for this/)).toBeInTheDocument();
  });

  it("says when nothing shipped and shows a refused draft", async () => {
    renderComponent(
      <DraftSheet
        posts={[]}
        draft={null}
        problem={{ kind: "conflict" }}
        onDraft={vi.fn()}
      />,
    );
    press("Draft from shipped requests");
    expect(
      await screen.findByText("No request has shipped yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
