import { describe } from "vite-plus/test";
import { describePageContract } from "../../test/contracts";
import { meta } from "./meta";
import { SamplePage } from "./sample-page";
describe("SamplePage", () => {
  describePageContract(meta, SamplePage, {
    loading: { prepare: () => ({ accessLoading: true }) },
    failed: { prepare: () => ({ accessProblem: { kind: "failed" } }) },
    ready: { prepare: () => ({}) },
  });
  /* TODO(quills-web): add behavior cases. */
});
