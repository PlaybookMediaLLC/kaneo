import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { SampleForm } from "./sample-form";
describe("SampleForm", () => {
  describeFormContract({
    render: (onSubmit) => renderComponent(<SampleForm onSubmit={onSubmit} />),
    fieldName: "TODO boardId",
    issuePath: "boardId",
    submitName: "TODO sample submit",
    validValue: "board-id_test_1",
    expectedValues: { content: "value", boardId: "board-id_test_1" },
  });
});
