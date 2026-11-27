"use client";

import { brand } from "@kaneo/branding";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { ArrowUpRight, ChevronDown, Code2, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DocsSectionIcon } from "@/components/docs/docs-section-icon";
import { DocsThemeToggle } from "@/components/docs/docs-theme-toggle";
import { Kbd } from "@/components/ui/kbd";
import {
  API_REFERENCE_PATH,
  type DocsSidebarSection,
  sectionContainsPath,
} from "@/lib/docs/links";
import { cn } from "@/lib/utils";

function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function DocsSidebar({ sections }: { sections: DocsSidebarSection[] }) {
  const pathname = usePathname() || "/docs";
  const current = normalizePath(pathname);
  const { setOpenSearch } = useSearchContext();
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      for (const section of sections) {
        initial[section.id] = sectionContainsPath(section, pathname);
      }
      if (!Object.values(initial).some(Boolean) && sections[0]) {
        initial[sections[0].id] = true;
      }
      return initial;
    },
  );

  useEffect(() => {
    setOpenSections((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const section of sections) {
        if (sectionContainsPath(section, pathname) && !next[section.id]) {
          next[section.id] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pathname, sections]);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "auto",
    });
  }, [current]);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <aside
      aria-label="Documentation navigation"
      className="fixed top-[3.25rem] bottom-0 left-0 z-30 hidden w-[16.75rem] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
    >
      <div className="shrink-0 p-3 pb-2">
        <button
          type="button"
          onClick={() => setOpenSearch(true)}
          className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-background/80 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        >
          <span className="flex items-center gap-2">
            <Search aria-hidden="true" className="size-3.5 shrink-0" />
            <span>Search docs...</span>
          </span>
          <Kbd className="border border-border bg-muted/80 px-1.5 text-[0.6875rem]">
            ⌘K
          </Kbd>
        </button>
      </div>

      <nav
        aria-label="Documentation sections"
        className="fd-scroll-container flex-1 overflow-y-auto px-3 py-2"
      >
        <div className="space-y-1">
          {sections.map((section) => {
            const isActiveSection = sectionContainsPath(section, pathname);
            const isOpen = Boolean(openSections[section.id]);

            return (
              <div key={section.id} className="pb-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleSection(section.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold tracking-tight transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-ring",
                    isActiveSection
                      ? "text-foreground"
                      : "text-sidebar-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <DocsSectionIcon
                      icon={section.icon}
                      className="size-3.5 shrink-0"
                    />
                    <span>{section.title}</span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {isOpen ? (
                  <div className="mt-1.5 space-y-3.5 pl-2">
                    {section.groups.map((group) => (
                      <div key={group.title} className="space-y-1">
                        <p className="px-2 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                          {group.title}
                        </p>
                        <ul className="space-y-0.5 border-l border-sidebar-border pl-2">
                          {group.items.map((item) => {
                            const active = normalizePath(item.href) === current;
                            return (
                              <li key={item.href}>
                                <Link
                                  ref={active ? activeLinkRef : undefined}
                                  href={item.href}
                                  aria-current={active ? "page" : undefined}
                                  className={cn(
                                    "block rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                                    active
                                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                      : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
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
          })}
        </div>
      </nav>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Link
            href={API_REFERENCE_PATH}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Code2 aria-hidden="true" className="size-3.5" />
            <span>API</span>
          </Link>
          <a
            href={brand.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <span>GitHub</span>
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </a>
        </div>
        <DocsThemeToggle />
      </div>
    </aside>
  );
}
