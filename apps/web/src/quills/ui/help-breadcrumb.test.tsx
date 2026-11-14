import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { HelpBreadcrumb } from "./help-breadcrumb";

describe("HelpBreadcrumb", () => {
  it("links each level in order", () => {
    const view = renderComponent(
      <HelpBreadcrumb
        items={[
          { label: "Acme help", href: "/portal/workspace_test_1/hc" },
          { label: "Guides", href: "/portal/workspace_test_1/hc/en/c" },
        ]}
      />,
    );
    const nav = view.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      [...nav.querySelectorAll("a")].map((link) => link.textContent),
    ).toEqual(["Acme help", "Guides"]);
    expect(view.getByRole("link", { name: "Guides" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc/en/c",
    );
  });
});
