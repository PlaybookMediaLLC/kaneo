import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { DateSeparator } from "./date-separator";

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

describe("DateSeparator", () => {
  it("names today and yesterday and dates older days", () => {
    const view = renderComponent(<DateSeparator date={daysAgo(0)} />);
    expect(view.getByText("Today")).toHaveAttribute("datetime");
    view.rerender(<DateSeparator date={daysAgo(1)} />);
    expect(view.getByText("Yesterday")).toBeVisible();
    view.rerender(<DateSeparator date="2025-10-31T12:00:00.000Z" />);
    expect(view.getByText("Fri, Oct 31")).toBeVisible();
  });
});
