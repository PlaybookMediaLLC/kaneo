import { Link } from "@tanstack/react-router";
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
import { teamHref } from "./team-href";

// The one seam in the upstream sidebar (app-sidebar.tsx). The entry opens the
// teammate app, which has its own shell. It is only a shortcut; the teammate
// API still decides access to every Quills page.
export function QuillsSidebarEntry() {
  // The sidebar renders before any Quills route loads the translations.
  useState(ensureQuillsI18n);
  const { t } = useTranslation("quills");
  const { data: workspace } = useActiveWorkspace();
  const { canReadQuills } = useWorkspacePermission();
  if (!workspace || !canReadQuills()) return null;
  return (
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
  );
}
