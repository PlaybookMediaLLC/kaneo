import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  getInitials,
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/upstream";
import { WorkspaceMenuItems } from "./workspace-menu-items";

export interface WorkspaceSwitcherProps {
  workspaceId: string;
  workspaceName?: string;
  workspaceLogo?: string | null;
  /** The caller's workspace role, shown as a small badge. */
  workspaceRole?: string;
}

const roles: Record<string, string> = {
  owner: "team.roles.owner",
  admin: "team.roles.admin",
  member: "team.roles.member",
};

/** The workspace at the top of the sidebar: switch to another workspace or go back to Kaneo. */
export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
  workspaceLogo,
  workspaceRole: role,
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation("quills");
  return (
    <Menu>
      <MenuTrigger className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-start outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar aria-hidden="true" className="size-6 rounded-md">
          {workspaceLogo ? (
            // quills-web-allow C3: the logo is decorative, so its image needs an empty alt.
            <AvatarImage src={workspaceLogo} alt="" />
          ) : null}
          <AvatarFallback className="rounded-md bg-primary text-[10px] font-semibold text-primary-foreground">
            {getInitials(workspaceName, "")}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-sm font-semibold">
          {workspaceName}
        </span>
        {role ? (
          <Badge variant="outline" size="sm" className="shrink-0">
            {roles[role] ? t(roles[role]) : role}
          </Badge>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className="ms-auto size-3.5 shrink-0 text-muted-foreground"
        />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-56">
        <MenuGroup>
          <MenuGroupLabel>{t("team.switcher")}</MenuGroupLabel>
          <WorkspaceMenuItems />
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          render={
            <Link
              to="/dashboard/workspace/$workspaceId"
              params={{ workspaceId }}
            />
          }
        >
          <ArrowLeft aria-hidden="true" />
          {t("team.back")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
