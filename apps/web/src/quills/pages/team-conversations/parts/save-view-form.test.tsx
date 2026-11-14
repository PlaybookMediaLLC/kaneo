import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { SaveViewForm } from "./save-view-form";

describe("SaveViewForm", () => {
  describeFormContract({
    render: (onSubmit) => renderComponent(<SaveViewForm onSubmit={onSubmit} />),
    fieldName: "View name",
    issuePath: "name",
    submitName: "Save view",
    validValue: " My snoozed ",
    expectedValues: { name: "My snoozed" },
    invalidValue: " ",
  });
});
