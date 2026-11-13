import { describe, expect, it } from "vite-plus/test";
import { getCustomerProfileFixture } from "../../../api/portal/get-customer-profile.fixture";
import { getPublicUserProfileFixture } from "../../../api/portal/get-public-user-profile.fixture";
import { renderComponent } from "../../../test/render";
import { ProfileSummary } from "./profile-summary";

describe("ProfileSummary", () => {
  it("shows canonical account and public activity without exposing extra fields", () => {
    const view = renderComponent(
      <ProfileSummary
        account={getCustomerProfileFixture.ok({
          name: "Ada",
          email: "ada@example.test",
        })}
        publicProfile={getPublicUserProfileFixture.ok({
          postCount: 2,
          commentCount: 1,
        })}
      />,
    );
    expect(
      view.getByText("ada@example.test", { exact: false }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("region", { name: "Recent portal activity" }),
    ).toBeInTheDocument();
  });
});
