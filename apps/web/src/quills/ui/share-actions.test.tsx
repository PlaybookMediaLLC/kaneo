import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../test/actions";
import { renderComponent } from "../test/render";
import { ShareActions } from "./share-actions";

describe("ShareActions", () => {
  it("copies the page address and confirms it", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const view = renderComponent(<ShareActions />);
    press("Copy link");
    expect(await view.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    vi.unstubAllGlobals();
  });

  it("copies the link from the compact pill when the browser cannot share", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText },
    });
    const view = renderComponent(<ShareActions compact />);
    expect(
      view.queryByRole("button", { name: "Copy link" }),
    ).not.toBeInTheDocument();
    press("Share");
    expect(await view.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("explains a failed share and stays quiet when the visitor cancels", async () => {
    const share = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockRejectedValueOnce(
        Object.assign(new Error("cancel"), { name: "AbortError" }),
      );
    vi.stubGlobal("navigator", { ...navigator, share });
    const view = renderComponent(<ShareActions />);
    press("Share");
    expect(
      await view.findByText("Sharing is not available. Copy the link instead."),
    ).toBeInTheDocument();
    press("Share");
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(
      view.getByText("Sharing is not available. Copy the link instead."),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
