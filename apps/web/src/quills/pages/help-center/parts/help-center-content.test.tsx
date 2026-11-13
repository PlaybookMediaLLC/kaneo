import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterFixture } from "../../../api/help-center/get-public-help-center.fixture";
import { searchPublicHelpCenterFixture } from "../../../api/help-center/search-public-help-center.fixture";
import { renderComponent } from "../../../test/render";
import { HelpCenterContent } from "./help-center-content";

describe("HelpCenterContent", () => {
  it("renders labelled search navigation", () => {
    const view = renderComponent(
      <HelpCenterContent
        workspaceId="workspace_test_1"
        home={getPublicHelpCenterFixture.ok()}
        results={undefined}
        searchQuery=""
      />,
    );
    expect(
      view.getByRole("textbox", { name: "Search the help center" }),
    ).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc",
    );
  });
  it("shows the query result state", () => {
    const view = renderComponent(
      <HelpCenterContent
        workspaceId="workspace_test_1"
        home={getPublicHelpCenterFixture.ok()}
        results={searchPublicHelpCenterFixture.ok()}
        searchQuery="reset"
      />,
    );
    expect(
      view.getByText("No articles match your search."),
    ).toBeInTheDocument();
  });
});
