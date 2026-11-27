import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppBadge } from "./app-badge";
import {
  authClient,
  i18n,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useActiveWorkspace,
  useWorkspacePermission,
} from "../ui/upstream";
import { teamHref } from "./team-href";

// The one seam in the upstream sidebar (app-sidebar.tsx). The entry opens the
// teammate app, which has its own shell. It is only a shortcut; the teammate
// API still decides access to every Quills page.
export function QuillsSidebarEntry() {
  const { t } = useTranslation("quills");
  const { data: workspace } = useActiveWorkspace();
  const { canReadQuills } = useWorkspacePermission();
  const { data: session } = authClient.useSession();
  const canRead = Boolean(workspace) && canReadQuills();
  const [, setI18nRev] = useState(0);
  // Load the Quills translation chunks lazily so the Kaneo main bundle stays small.
  useEffect(() => {
    if (!canRead || i18n.getResource("en-US", "quills", "team") !== undefined)
      return;
    let alive = true;
    void import("../i18n/load")
      .then(({ ensureQuillsI18n }) => ensureQuillsI18n())
      .then(() => {
        if (alive) setI18nRev((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canRead]);
  if (!workspace) return null;
  // The desktop app's badge: every Kaneo page has this sidebar.
  const badge = session ? (
    <AppBadge
      workspaceId={workspace.id}
      viewer={{ kind: "user", id: session.user.id }}
      quills={canRead}
    />
  ) : null;
  if (!canRead) return badge;
  return (
    <>
      {badge}
      <SidebarGroup className="px-2 py-0">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("team.title")}
                className="h-8 text-sm"
                render={<Link to={teamHref(workspace.id)} />}
              >
                <MessagesSquare aria-hidden="true" />
                <span>{t("team.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
