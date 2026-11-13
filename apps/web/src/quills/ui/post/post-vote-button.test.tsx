import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostVoteButton } from "./post-vote-button";
describe("PostVoteButton", () => {
  it("exposes vote state and requests the reverse action", async () => {
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <PostVoteButton voted voteCount={3} onVote={onVote} />,
    );
    expect(view.getByRole("button", { name: /remove vote/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.getByText(/3 votes/i)).toBeInTheDocument();
    press(/remove vote/i);
    expect(onVote).toHaveBeenCalledWith(false);
  });

  it("refuses a vote while framed", async () => {
    const top = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { configurable: true, value: {} });
    const onVote = vi.fn(async () => undefined);
    const view = renderComponent(
      <PostVoteButton voted={false} voteCount={3} onVote={onVote} />,
    );

    press(/^vote$/i);

    expect(await view.findByRole("alert")).toHaveTextContent(/new tab/i);
    expect(onVote).not.toHaveBeenCalled();
    if (top) Object.defineProperty(window, "top", top);
  });

  it("waits for a rate-limit deadline before allowing reset", () => {
    const onRetry = vi.fn();
    const view = renderComponent(
      <PostVoteButton
        voted={false}
        voteCount={3}
        problem={{ kind: "rateLimited", retryAt: Date.now() + 30_000 }}
        onRetry={onRetry}
        onVote={vi.fn(async () => undefined)}
      />,
    );

    expect(view.getByRole("button", { name: /try again/i })).toBeDisabled();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
