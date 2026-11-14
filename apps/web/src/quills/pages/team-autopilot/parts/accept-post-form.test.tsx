import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { AcceptPostForm } from "./accept-post-form";
describe("AcceptPostForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <AcceptPostForm
          boards={[{ id: "board_test_1", name: "Ideas" }]}
          title=""
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "Post title",
    issuePath: "title",
    submitName: "Create post",
    validValue: "Dark theme",
    expectedValues: { boardId: "board_test_1", title: "Dark theme" },
    invalidValue: " ",
  });
});
