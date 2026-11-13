import { describe, expect, it } from "vite-plus/test";
import { getPublicHelpCenterFixture } from "../../../api/help-center/get-public-help-center.fixture";
import { searchPublicHelpCenterFixture } from "../../../api/help-center/search-public-help-center.fixture";
import { renderComponent } from "../../../test/render";
import { HelpCenterLocaleContent } from "./help-center-locale-content";

describe("HelpCenterLocaleContent", () => {
  it("keeps the locale in search navigation", () => {
    const view = renderComponent(
      <HelpCenterLocaleContent
        workspaceId="workspace_test_1"
        locale="fr"
        home={getPublicHelpCenterFixture.ok()}
        results={undefined}
        searchQuery=""
      />,
    );
    expect(
      view.getByRole("button", { name: "Search" }).closest("form"),
    ).toHaveAttribute("action", "/portal/workspace_test_1/hc/fr");
  });
  it("shows the localized query result state", () => {
    const view = renderComponent(
      <HelpCenterLocaleContent
        workspaceId="workspace_test_1"
        locale="fr"
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
