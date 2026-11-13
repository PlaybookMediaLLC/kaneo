import { describe } from "vite-plus/test";
import { describePageContract } from "../../test/contracts";
import { meta } from "./meta";
import { {{COMPONENT}}Page } from "./{{ID}}-page";
describe("{{COMPONENT}}Page", () => {
  describePageContract(meta, {{COMPONENT}}Page, {
{{CASES}}
  });
  /* TODO(quills-web): add behavior cases. */
});
