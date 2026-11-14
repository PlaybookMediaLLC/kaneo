import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { TaskSyncForm } from "./task-sync-form";

const statuses = [
  { id: "post_status_test_1", name: "Open" },
  { id: "post_status_test_2", name: "Complete" },
];

describe("TaskSyncForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <TaskSyncForm
          statusOnTaskDone={null}
          statuses={statuses}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "When a linked task is done, set the status to",
    issuePath: "statusOnTaskDone",
    submitName: "Save task sync",
    validValue: "post_status_test_2",
    expectedValues: { statusOnTaskDone: "post_status_test_2" },
  });
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <TaskSyncForm
          statusOnTaskDone="post_status_test_2"
          statuses={statuses}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "When a linked task is done, set the status to",
    issuePath: "statusOnTaskDone",
    submitName: "Save task sync",
    validValue: "",
    expectedValues: { statusOnTaskDone: null },
  });
});
