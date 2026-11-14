import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { MeterList } from "./meter-list";

describe("MeterList", () => {
  it("labels a meter for each count", () => {
    const view = renderComponent(
      <MeterList
        titleKey="insights.topics"
        emptyKey="insights.noTopics"
        max={5}
        items={[
          { id: "tag_test_1", label: "Billing", value: 5 },
          { id: "tag_test_2", label: "Exports", value: 2 },
        ]}
      />,
    );
    expect(
      view.getByRole("heading", { name: "Topics of new posts" }),
    ).toBeInTheDocument();
    const meter = view.getByLabelText("Exports");
    expect(meter.tagName).toBe("METER");
    expect(meter).toHaveAttribute("value", "2");
    expect(meter).toHaveAttribute("max", "5");
  });

  it("says when there is nothing to count", () => {
    const view = renderComponent(
      <MeterList
        titleKey="insights.sentiment"
        emptyKey="insights.noSentiment"
        max={0}
        items={[{ id: "positive", label: "Positive", value: 0 }]}
      />,
    );
    expect(
      view.getByText("No new post has a sentiment yet."),
    ).toBeInTheDocument();
    expect(view.queryByLabelText("Positive")).not.toBeInTheDocument();
  });
});
