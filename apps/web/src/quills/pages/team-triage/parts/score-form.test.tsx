import { describe } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { ScoreForm } from "./score-form";

const empty = { reach: null, impact: null, confidence: null, effort: null };

describe("ScoreForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <ScoreForm score={{ ...empty, impact: 2 }} onSubmit={onSubmit} />,
      ),
    fieldName: "Reach",
    issuePath: "reach",
    submitName: "Save score",
    validValue: "120",
    invalidValue: "-3",
    expectedValues: { ...empty, impact: 2, reach: 120 },
  });
});
