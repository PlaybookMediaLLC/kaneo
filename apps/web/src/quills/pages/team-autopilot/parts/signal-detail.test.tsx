import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import { SignalDetail } from "./signal-detail";

describe("SignalDetail", () => {
  it("shows the excerpt and the match", () => {
    const view = renderComponent(
      <SignalDetail signal={signalsFixture.signal()} />,
    );
    expect(view.getByText("Please add a dark mode.")).toBeInTheDocument();
    expect(
      view.getByText("Matches “Dark mode” · Ideas · 1 vote"),
    ).toBeInTheDocument();
  });

  it("names the post that an accepted signal became", () => {
    const view = renderComponent(
      <SignalDetail
        signal={signalsFixture.signal({
          status: "accepted",
          customer: { principalId: "principal_test_1", displayName: null },
          matchedPost: null,
          resultingPost: signalsFixture.post,
        })}
      />,
    );
    expect(view.getByText("Added to “Dark mode”")).toBeInTheDocument();
    expect(view.queryByText(/^Matches/)).toBeNull();
  });
});
