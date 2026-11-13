import { describe, expect, it } from "vite-plus/test";
import { KitGallery } from "@/quills/dev/kit-gallery";
import { i18n } from "@/quills/ui/upstream";
import { Route } from "./kit";

describe("kit route", () => {
  it("loads translations and the gallery in development", async () => {
    const beforeLoad = Route.options.beforeLoad as () => Promise<void>;
    await beforeLoad();
    expect(i18n.hasResourceBundle("en-US", "quills")).toBe(true);
    expect(Route.options.component).toBe(KitGallery);
  });
});
