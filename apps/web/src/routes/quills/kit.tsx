import { createFileRoute, notFound } from "@tanstack/react-router";
import { KitGallery } from "@/quills/dev/kit-gallery";
import { ensureQuillsI18n } from "@/quills/i18n/load";

export const Route = createFileRoute("/quills/kit")({
  beforeLoad: async () => {
    if (!import.meta.env.DEV) throw notFound();
    await ensureQuillsI18n();
  },
  component: KitGallery,
});
