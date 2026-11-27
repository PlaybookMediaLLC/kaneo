import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { DesktopSignInPage } from "@/quills/pages/desktop-sign-in/desktop-sign-in-page";

// The desktop app's browser sign-in. `start` opens the browser at once; `provider` names the
// sign-in page that the app replaced. `link` is the browser half of a Google link.
const searchSchema = z.object({
  start: z.boolean().optional().catch(undefined),
  provider: z.enum(["google"]).optional().catch(undefined),
  link: z.enum(["google"]).optional().catch(undefined),
  user: z.string().max(100).optional().catch(undefined),
  linked: z.boolean().optional().catch(undefined),
  failed: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/quills/desktop")({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const { ensureQuillsI18n } = await import("@/quills/i18n/load");
    await ensureQuillsI18n();
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <DesktopSignInPage
      workspaceId=""
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
