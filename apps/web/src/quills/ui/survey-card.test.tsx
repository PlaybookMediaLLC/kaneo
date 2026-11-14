import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { fill, press } from "../test/actions";
import { renderComponent } from "../test/render";
import { SurveyCard } from "./survey-card";

const nps = {
  type: "nps",
  question: "How likely are you to recommend us?",
  options: [],
  scale: { min: 0, max: 10 },
};

describe("SurveyCard", () => {
  it("offers one radio for each score of the scale", () => {
    const view = renderComponent(
      <SurveyCard
        survey={nps}
        done={false}
        onSubmit={async () => undefined}
        onDismiss={() => {}}
      />,
    );
    const group = view.getByRole("radiogroup", {
      name: "How likely are you to recommend us?",
    });
    expect(group.querySelectorAll("input[type=radio]")).toHaveLength(11);
    expect(view.getByRole("radio", { name: "0" })).toBeInTheDocument();
    expect(view.getByRole("radio", { name: "10" })).toBeInTheDocument();
    expect(
      view.getByRole("heading", {
        name: "How likely are you to recommend us?",
      }),
    ).toBeInTheDocument();
  });

  it("sends the score with the comment, and asks for a score first", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <SurveyCard
        survey={nps}
        done={false}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
    press("Send answer");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Choose an answer",
    );
    fireEvent.click(view.getByRole("radio", { name: "9" }));
    fill("Comment (optional)", "Fast exports");
    press("Send answer");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        score: 9,
        comment: "Fast exports",
      }),
    );
  });

  it("sends a choice for a poll and a text answer for an open question", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const poll = renderComponent(
      <SurveyCard
        survey={{
          type: "poll",
          question: "Which export first?",
          options: ["CSV", "PDF"],
          scale: null,
        }}
        done={false}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(poll.getByRole("radio", { name: "PDF" }));
    press("Send answer");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ choice: "PDF" }),
    );
    poll.unmount();
    const open = renderComponent(
      <SurveyCard
        survey={{
          type: "open",
          question: "What should we build?",
          options: [],
          scale: null,
        }}
        done={false}
        onSubmit={onSubmit}
        onDismiss={() => {}}
      />,
    );
    expect(open.queryByRole("radiogroup")).not.toBeInTheDocument();
    fill("Your answer", "Slack alerts");
    press("Send answer");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenLastCalledWith({ comment: "Slack alerts" }),
    );
  });

  it("thanks the customer and closes on dismiss", () => {
    const onDismiss = vi.fn();
    const view = renderComponent(
      <SurveyCard
        survey={nps}
        done
        onSubmit={async () => undefined}
        onDismiss={onDismiss}
      />,
    );
    expect(view.getByRole("status")).toHaveTextContent(
      "Thanks for your answer",
    );
    press("Not now");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
