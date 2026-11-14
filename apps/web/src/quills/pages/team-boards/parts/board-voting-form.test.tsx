import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { BoardVotingForm } from "./board-voting-form";

describe("BoardVotingForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <BoardVotingForm
          settings={{ voteDisplay: "count", defaultSort: null }}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "Vote counts",
    issuePath: "voteDisplay",
    submitName: "Save voting settings",
    validValue: "hidden",
    expectedValues: { voteDisplay: "hidden", defaultSort: null },
  });
});
