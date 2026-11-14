import { Link, useLocation } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ensureQuillsI18n } from "../i18n/load";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useActiveWorkspace,
  useWorkspacePermission,
} from "../ui/upstream";

// The one seam in the upstream sidebar (app-sidebar.tsx). The entry is only a
// shortcut; the teammate API still decides access to every Quills page.
export function QuillsSidebarEntry() {
  // The sidebar renders before any Quills route loads the translations.
  useState(ensureQuillsI18n);
  const { t } = useTranslation("quills");
  const { data: workspace } = useActiveWorkspace();
  const { canReadQuills } = useWorkspacePermission();
  const pathname = useLocation({ select: (location) => location.pathname });
  if (!workspace || !canReadQuills()) return null;
  const url = `/dashboard/workspace/${encodeURIComponent(workspace.id)}/quills`;
  return (
    <SidebarGroup className="px-2 py-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("team.title")}
              isActive={pathname === url || pathname.startsWith(`${url}/`)}
              className="h-8 text-sm"
              render={<Link to={url} />}
            >
              <MessagesSquare aria-hidden="true" />
              <span>{t("team.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
