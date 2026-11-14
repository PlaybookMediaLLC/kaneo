import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { choose, fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { CreateSurveyForm } from "./create-survey-form";

describe("CreateSurveyForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(<CreateSurveyForm onSubmit={onSubmit} />),
    fieldName: "Question",
    issuePath: "question",
    submitName: "Create draft",
    validValue: "How likely are you to recommend us?",
    invalidValue: " ",
    expectedValues: {
      type: "nps",
      question: "How likely are you to recommend us?",
    },
  });

  it("sends the answers of a poll, one for each line", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(<CreateSurveyForm onSubmit={onSubmit} />);
    await choose("Type", "Poll");
    fill("Question", "Which export first?");
    fill("Answers, one on each line", "CSV\n\n PDF ");
    press("Create draft");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        type: "poll",
        question: "Which export first?",
        options: ["CSV", "PDF"],
      }),
    );
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for two different poll answers", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(<CreateSurveyForm onSubmit={onSubmit} />);
    await choose("Type", "Poll");
    fill("Question", "Which export first?");
    fill("Answers, one on each line", "CSV\nCSV");
    fireEvent.click(view.getByRole("button", { name: "Create draft" }));
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Give 2 to 20 different answers",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
