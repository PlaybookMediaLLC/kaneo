import { type MouseEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import type { PortalNav } from "../core/portal-nav";

export interface PortalNavigationProps {
  workspaceId: string;
  currentPath: string;
  /** The tabs that the public portal config turns on. */
  nav: PortalNav;
  /** Optional SPA navigation callback provided by the portal shell. */
  onNavigate?: (href: string) => void;
}

export function PortalNavigation({
  workspaceId,
  currentPath,
  nav,
  onNavigate,
}: PortalNavigationProps) {
  const { t } = useTranslation("quills");
  const root = portalHref(workspaceId);
  const section = currentPath.slice(root.length).split("/")[1] || "";
  const navRef = useRef<HTMLElement>(null);
  // Below lg the tabs scroll sideways; the current one may start off screen.
  useEffect(() => {
    navRef.current
      ?.querySelector("[aria-current]")
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [section]);
  return (
    <nav
      ref={navRef}
      className="portal-navigation order-3 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto pb-1 max-sm:pe-8 max-sm:mask-r-from-[calc(100%-2rem)] lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:pb-0 [&_a]:whitespace-nowrap [&_a]:rounded-full [&_a]:px-2.5 [&_a]:py-1 [&_a]:text-sm [&_a]:text-muted-foreground [&_a[aria-current]]:font-medium [&_a:hover]:bg-muted [&_a:hover]:text-foreground [&_a[aria-current]]:bg-muted [&_a[aria-current]]:text-foreground"
      aria-label={t("core.navigation")}
    >
      {[
        {
          tab: "feedback",
          path: "",
          label: "core.navFeedback",
          active: ["", "boards", "posts"].includes(section),
        },
        {
          tab: "roadmap",
          path: "roadmap",
          label: "core.navRoadmap",
          active: section === "roadmap",
        },
        {
          tab: "changelog",
          path: "changelog",
          label: "core.navUpdates",
          active: section === "changelog",
        },
        {
          tab: "help",
          path: "hc",
          label: "core.navHelp",
          active: section === "hc",
        },
        {
          tab: "status",
          path: "status",
          label: "core.navStatus",
          active: section === "status",
        },
        {
          tab: "support",
          path: "support",
          label: "core.navSupport",
          active: ["support", "tickets", "conversations"].includes(section),
        },
      ]
        .filter((item) => nav.tabs[item.tab as keyof typeof nav.tabs])
        .map((item) => {
          const href = portalHref(workspaceId, item.path);
          return (
            <a
              key={item.path}
              href={href}
              aria-current={item.active ? "page" : undefined}
              onClick={
                onNavigate
                  ? (event: MouseEvent<HTMLAnchorElement>) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      onNavigate(href);
                    }
                  : undefined
              }
            >
              {t(item.label)}
            </a>
          );
        })}
      {nav.links.map((link) => (
        <a
          key={`${link.label} ${link.url}`}
          href={link.url}
          {...(link.newTab && { target: "_blank", rel: "noopener noreferrer" })}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
