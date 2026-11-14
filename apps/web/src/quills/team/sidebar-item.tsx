import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PostStatusIcon } from "../ui/inbox/post-status-icon";
import { cn, toast } from "../ui/upstream";
import type { TeamNavItem } from "./nav";

export interface SidebarItemProps {
  item: TeamNavItem;
  /** Runs after the item is chosen, for example to close the sheet on small screens. */
  onNavigate?: () => void;
}

const row =
  "flex h-8 w-full items-center gap-2 rounded-lg border border-transparent px-2 text-start text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-border aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-xs [&>svg]:size-4 [&>svg]:shrink-0";

/** One sidebar view: icon, label and a right-aligned count. The current view is a white pill. */
export function SidebarItem({ item, onNavigate }: SidebarItemProps) {
  const { t } = useTranslation("quills");
  const Icon = item.icon;
  const content = (
    <>
      {item.status ? (
        <PostStatusIcon {...item.status} className="mx-px" />
      ) : Icon ? (
        <Icon aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {item.label ?? t(item.labelKey ?? "")}
      </span>{" "}
      {item.count === undefined ? null : (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
            item.attention && item.count > 0
              ? "bg-priority-high font-semibold text-background"
              : "text-muted-foreground",
          )}
        >
          {item.count}
        </span>
      )}
    </>
  );
  if (item.copy)
    return (
      <button
        type="button"
        className={row}
        onClick={() => {
          const link = new URL(item.to, window.location.origin).href;
          const copy = navigator.clipboard
            ? navigator.clipboard.writeText(link)
            : Promise.reject(new Error("No clipboard"));
          void copy.then(
            () => toast.success(t("team.shareCopied")),
            () => toast.error(t("core.problem.failed")),
          );
        }}
      >
        {content}
      </button>
    );
  if (item.newTab)
    return (
      <a href={item.to} target="_blank" rel="noreferrer" className={row}>
        {content}
      </a>
    );
  return (
    <Link
      to={item.to}
      search={item.search}
      activeOptions={{ exact: item.exact ?? false, includeSearch: true }}
      onClick={onNavigate}
      className={row}
    >
      {content}
    </Link>
  );
}
