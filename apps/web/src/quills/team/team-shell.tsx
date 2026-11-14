import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { teamNavigation } from "./nav";

export interface TeamShellProps {
  workspaceId: string;
  children: ReactNode;
}

const tab =
  "inline-flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground";

export function TeamShell({ workspaceId, children }: TeamShellProps) {
  const { t } = useTranslation("quills");
  const base = `/dashboard/workspace/${encodeURIComponent(workspaceId)}/quills`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label={t("team.navigation")}
        className="shrink-0 border-b border-border px-3 py-1.5"
      >
        <ul className="flex gap-1 overflow-x-auto">
          {teamNavigation.map((entry) => (
            <li key={entry.path}>
              <Link
                to={`${base}${entry.path}`}
                activeOptions={{ exact: entry.path === "" }}
                className={tab}
              >
                {t(entry.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
