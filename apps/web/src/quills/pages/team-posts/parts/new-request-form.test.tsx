import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { inboxBoards, inboxStatuses, inboxTags } from "../inbox.fixture";
import { NewRequestForm } from "./new-request-form";

describe("NewRequestForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <NewRequestForm
          boards={inboxBoards.items}
          statuses={inboxStatuses.statuses}
          tags={inboxTags.tags}
          author={null}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "Submission title",
    issuePath: "title",
    submitName: "Create",
    validValue: "Dark mode",
    invalidValue: "   ",
    // The first board and the default status.
    expectedValues: {
      boardId: "board_ideas",
      title: "Dark mode",
      content: "",
      statusId: "status_open",
      tagIds: [],
    },
  });
});
