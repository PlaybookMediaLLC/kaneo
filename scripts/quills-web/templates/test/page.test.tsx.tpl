import { describe } from "vite-plus/test";
import { describePageContract } from "../../test/contracts";
{{IMPORTS}}import { meta } from "./meta";
import { {{NAME}} } from {{LOCAL}};
describe({{NAME_JSON}}, () => {
  describePageContract(meta, {{NAME}}, {
{{CASES}}
  });
  describe("behavior", () => {});
});
