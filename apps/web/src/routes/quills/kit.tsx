import { createFileRoute, notFound } from "@tanstack/react-router";
import { KitGallery } from "@/quills/dev/kit-gallery";

export const Route = createFileRoute("/quills/kit")({
  beforeLoad: async () => {
    if (!import.meta.env.DEV) throw notFound();
    const { ensureQuillsI18n } = await import("@/quills/i18n/load");
    await ensureQuillsI18n();
  },
  component: KitGallery,
});
