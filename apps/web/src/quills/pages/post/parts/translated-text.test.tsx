import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { translatePortalContentFixture } from "../../../api/feedback/translate-portal-content.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TranslatedText } from "./translated-text";

const browser = (language: string) =>
  vi.spyOn(navigator, "language", "get").mockReturnValue(language);

const post = (
  <TranslatedText
    workspaceId="workspace_test_1"
    viewer={{ kind: "anonymous" }}
    target={{ postId: "post_test_1" }}
    title="Dark mode"
    content="Please add dark mode."
  />
);

describe("TranslatedText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers no translation to an English browser", () => {
    browser("en-GB");
    const api = mockApi();
    const view = renderComponent(post);
    expect(view.getByText("Please add dark mode.")).toBeInTheDocument();
    expect(view.queryByRole("button")).not.toBeInTheDocument();
    expect(api.calls()).toHaveLength(0);
  });

  it("translates on request and shows the original again", async () => {
    browser("de-DE");
    const api = mockApi();
    api.reply(
      translatePortalContentFixture.ok({
        title: "Dunkelmodus",
        content: "Bitte Dunkelmodus hinzufügen.",
      }),
    );
    const view = renderComponent(post);
    expect(api.calls()).toHaveLength(0);
    press("Translate");
    expect(
      await view.findByText("Bitte Dunkelmodus hinzufügen."),
    ).toBeInTheDocument();
    expect(view.getByText("Dunkelmodus")).toBeInTheDocument();
    const [request] = api.calls("translateQuillsPortalContent");
    expect(await request!.json()).toEqual({
      postId: "post_test_1",
      locale: "de-DE",
    });
    press("Show original");
    expect(view.getByText("Please add dark mode.")).toBeInTheDocument();
    // The translation is kept: a second toggle makes no new call.
    press("Translate");
    expect(
      await view.findByText("Bitte Dunkelmodus hinzufügen."),
    ).toBeInTheDocument();
    expect(api.calls()).toHaveLength(1);
  });

  it("keeps the original text when the translation fails", async () => {
    browser("fr");
    const api = mockApi();
    api.reply(translatePortalContentFixture.problem(409).body, 409);
    const view = renderComponent(
      <TranslatedText
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        target={{ commentId: "post_comment_test_1" }}
        content="Same here."
      />,
    );
    press("Translate");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "The translation is not available. Try again later.",
    );
    expect(view.getByText("Same here.")).toBeInTheDocument();
    const [request] = api.calls("translateQuillsPortalContent");
    expect(await request!.json()).toEqual({
      commentId: "post_comment_test_1",
      locale: "fr",
    });
  });
});
