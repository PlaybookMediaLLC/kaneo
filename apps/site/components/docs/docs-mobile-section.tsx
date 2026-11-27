"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DocsSectionIcon } from "@/components/docs/docs-section-icon";
import { type DocsSidebarSection, sectionContainsPath } from "@/lib/docs/links";
import { cn } from "@/lib/utils";

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function DocsMobileSection({
  section,
  pathname,
  onNavigate,
}: {
  section: DocsSidebarSection;
  pathname: string;
  onNavigate: () => void;
}) {
  const isActiveSection = sectionContainsPath(section, pathname);
  const [open, setOpen] = useState(isActiveSection);
  const current = normalizePath(pathname);

  return (
    <div className="border-b border-border/60 py-2 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
          isActiveSection ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="flex items-center gap-2">
          <DocsSectionIcon icon={section.icon} className="size-4 shrink-0" />
          <span>{section.title}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="mt-1 space-y-4 pb-2 pl-2">
          {section.groups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {group.title}
              </p>
              <ul className="space-y-0.5 border-l border-border pl-2">
                {group.items.map((item) => {
                  const active = normalizePath(item.href) === current;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
