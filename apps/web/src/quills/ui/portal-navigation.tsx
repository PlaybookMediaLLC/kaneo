import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";

export interface PortalNavigationProps {
  workspaceId: string;
  currentPath: string;
}

export function PortalNavigation({
  workspaceId,
  currentPath,
}: PortalNavigationProps) {
  const { t } = useTranslation("quills");
  const root = portalHref(workspaceId);
  const section = currentPath.slice(root.length).split("/")[1] || "";
  return (
    <nav
      className="portal-navigation order-3 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto pb-1 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:pb-0 [&_a]:whitespace-nowrap [&_a]:rounded-full [&_a]:px-2.5 [&_a]:py-1 [&_a]:text-sm [&_a]:text-muted-foreground [&_a[aria-current]]:font-medium [&_a:hover]:bg-muted [&_a:hover]:text-foreground [&_a[aria-current]]:bg-muted [&_a[aria-current]]:text-foreground"
      aria-label={t("core.navigation")}
    >
      {[
        {
          path: "",
          label: "core.navFeedback",
          active: ["", "boards", "posts"].includes(section),
        },
        {
          path: "roadmap",
          label: "core.navRoadmap",
          active: section === "roadmap",
        },
        {
          path: "changelog",
          label: "core.navUpdates",
          active: section === "changelog",
        },
        { path: "hc", label: "core.navHelp", active: section === "hc" },
        {
          path: "status",
          label: "core.navStatus",
          active: section === "status",
        },
        {
          path: "support",
          label: "core.navSupport",
          active: ["support", "tickets", "conversations"].includes(section),
        },
      ].map((item) => (
        <a
          key={item.path}
          href={portalHref(workspaceId, item.path)}
          aria-current={item.active ? "page" : undefined}
        >
          {t(item.label)}
        </a>
      ))}
    </nav>
  );
}
