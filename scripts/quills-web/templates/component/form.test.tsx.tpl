import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { {{NAME}} } from "./{{FILE}}";
describe({{NAME_JSON}}, () => {
  describeFormContract({
    render: (onSubmit) => renderComponent(<{{NAME}} onSubmit={onSubmit} />),
    fieldName: {{FIELD_NAME}},
    issuePath: {{ISSUE_PATH}},
    submitName: {{SUBMIT_NAME}},
    validValue: {{VALID_VALUE}},
    expectedValues: {{EXPECTED_VALUES}},
  });
});
