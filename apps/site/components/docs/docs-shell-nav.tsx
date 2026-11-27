"use client";

import { brand } from "@kaneo/branding";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DocsMobileSection } from "@/components/docs/docs-mobile-section";
import { DocsThemeToggle } from "@/components/docs/docs-theme-toggle";
import { Logo } from "@/components/landing/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  API_REFERENCE_PATH,
  DOCS_BASE_PATH,
  type DocsSidebarSection,
} from "@/lib/docs/links";
import { cn } from "@/lib/utils";

const TOP_NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: DOCS_BASE_PATH, label: "Docs" },
  { href: API_REFERENCE_PATH, label: "API Reference" },
  { href: "/guides", label: "Guides" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
];

export function DocsShellNav({ sections }: { sections: DocsSidebarSection[] }) {
  const pathname = usePathname() || DOCS_BASE_PATH;
  const { setOpenSearch } = useSearchContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-[3.25rem] items-center border-b border-border bg-background/85 backdrop-blur-md">
      {/* Left brand cell aligned with desktop sidebar width */}
      <div className="flex h-full items-center gap-2.5 px-4 lg:w-[16.75rem] lg:shrink-0 lg:border-r lg:border-sidebar-border">
        <Link
          href="/"
          aria-label={`${brand.name} home`}
          className="inline-flex items-center text-foreground hover:opacity-85"
        >
          <Logo />
        </Link>
        <Link href={DOCS_BASE_PATH} className="inline-flex items-center">
          <Badge variant="secondary" className="text-[0.6875rem] font-medium">
            Docs
          </Badge>
        </Link>
      </div>

      {/* Center navigation tabs */}
      <nav
        aria-label="Primary"
        className="hidden flex-1 items-center gap-1 px-6 md:flex"
      >
        {TOP_NAV_LINKS.map((item) => {
          const isActive =
            item.href === DOCS_BASE_PATH
              ? pathname === DOCS_BASE_PATH ||
                pathname.startsWith(`${DOCS_BASE_PATH}/`)
              : item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right actions + mobile controls */}
      <div className="ml-auto flex items-center gap-1.5 px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Search documentation"
          onClick={() => setOpenSearch(true)}
          className="text-muted-foreground hover:text-foreground lg:hidden"
        >
          <Search className="size-4" />
        </Button>

        <DocsThemeToggle className="lg:hidden" />

        <Button
          className="hidden text-xs sm:inline-flex"
          size="sm"
          variant="ghost"
          render={<a href={`${brand.clientUrl}/auth/sign-in`} />}
        >
          Sign in
        </Button>
        <Button
          className="hidden text-xs sm:inline-flex"
          size="sm"
          render={<a href={`${brand.clientUrl}/auth/sign-up`} />}
        >
          Get started
        </Button>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            aria-label="Open documentation menu"
            render={
              <Button className="lg:hidden" size="icon-sm" variant="ghost" />
            }
          >
            <Menu className="size-4" />
          </SheetTrigger>
          <SheetPopup
            side="left"
            showCloseButton={false}
            className="w-[86vw] max-w-sm bg-background p-0"
          >
            <SheetTitle className="sr-only">Documentation menu</SheetTitle>
            <div className="flex h-[3.25rem] shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
                <Link
                  href="/"
                  onClick={() => setMobileOpen(false)}
                  aria-label={`${brand.name} home`}
                >
                  <Logo />
                </Link>
                <Badge variant="secondary" className="text-[0.6875rem]">
                  Docs
                </Badge>
              </div>
              <SheetClose
                aria-label="Close documentation menu"
                render={<Button size="icon-sm" variant="ghost" />}
              >
                <X className="size-4" />
              </SheetClose>
            </div>

            <div className="fd-scroll-container flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 grid grid-cols-2 gap-1 border-b border-border pb-3">
                {TOP_NAV_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <div>
                {sections.map((section) => (
                  <DocsMobileSection
                    key={section.id}
                    section={section}
                    pathname={pathname}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
              <Button
                size="sm"
                variant="outline"
                render={<a href={`${brand.clientUrl}/auth/sign-in`} />}
              >
                Sign in
              </Button>
              <Button
                size="sm"
                render={<a href={`${brand.clientUrl}/auth/sign-up`} />}
              >
                Get started
              </Button>
            </div>
          </SheetPopup>
        </Sheet>
      </div>
    </header>
  );
}
