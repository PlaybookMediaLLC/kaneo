import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ComposerSignIn } from "./composer-sign-in";

describe("ComposerSignIn", () => {
  it("links to the sign-in page", () => {
    const view = renderComponent(<ComposerSignIn href="/auth/sign-in" />);
    expect(view.getByText("Sign in to submit feedback.")).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in",
    );
  });
});
