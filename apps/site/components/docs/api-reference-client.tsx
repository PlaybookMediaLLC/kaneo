"use client";

import "@scalar/api-reference-react/style.css";
import { brand } from "@kaneo/branding";
import type { AnyApiReferenceConfiguration } from "@scalar/api-reference-react";
import { ArrowLeft, FileJson } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DocsThemeToggle } from "@/components/docs/docs-theme-toggle";
import { Logo } from "@/components/landing/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOCS_BASE_PATH } from "@/lib/docs/links";
import {
  resolveIsDark,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

const ScalarApiReference = dynamic(
  () =>
    import("@scalar/api-reference-react").then((mod) => ({
      default: mod.ApiReferenceReact,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Loading interactive API reference...
      </div>
    ),
  },
);

const SCALAR_CUSTOM_CSS = `
  .light-mode,
  .dark-mode,
  :root {
    --scalar-font: var(--font-sans);
    --scalar-font-code: var(--font-mono);
    --scalar-background-1: var(--background);
    --scalar-background-2: var(--card);
    --scalar-background-3: var(--muted);
    --scalar-background-accent: var(--accent);
    --scalar-color-1: var(--foreground);
    --scalar-color-2: var(--muted-foreground);
    --scalar-color-3: var(--muted-foreground);
    --scalar-color-accent: var(--primary);
    --scalar-border-color: var(--border);
    --scalar-radius: var(--radius);
    --scalar-radius-lg: var(--radius-lg);
    --scalar-radius-xl: var(--radius-xl);
    --scalar-sidebar-background-1: var(--sidebar);
    --scalar-sidebar-color-1: var(--foreground);
    --scalar-sidebar-color-2: var(--sidebar-foreground);
    --scalar-sidebar-color-active: var(--sidebar-accent-foreground);
    --scalar-sidebar-item-hover-background: var(--sidebar-accent);
    --scalar-sidebar-item-hover-color: var(--sidebar-accent-foreground);
    --scalar-sidebar-item-active-background: var(--sidebar-accent);
    --scalar-sidebar-border-color: var(--sidebar-border);
    --scalar-sidebar-search-background: var(--background);
    --scalar-sidebar-search-border-color: var(--border);
    --scalar-sidebar-search-color: var(--foreground);
    --scalar-header-height: 3.25rem;
    --scalar-custom-header-height: 3.25rem;
  }
`;

export function ApiReferenceClient() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setIsDark(resolveIsDark());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        sync();
      }
    };

    sync();
    media.addEventListener("change", sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const configuration = useMemo<AnyApiReferenceConfiguration>(
    () => ({
      url: "/openapi.json",
      telemetry: false,
      showDeveloperTools: "never",
      withDefaultFonts: false,
      darkMode: isDark,
      forceDarkModeState: isDark ? "dark" : "light",
      hideDarkModeToggle: true,
      defaultHttpClient: {
        targetKey: "shell",
        clientKey: "curl",
      },
      agent: {
        disabled: true,
      },
      mcp: {
        disabled: true,
      },
      customCss: SCALAR_CUSTOM_CSS,
    }),
    [isDark],
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-[3.25rem] items-center justify-between gap-4 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label={`${brand.name} home`}
            className="inline-flex items-center text-foreground hover:opacity-85"
          >
            <Logo />
          </Link>
          <Badge variant="secondary" className="text-[0.6875rem] font-medium">
            API Reference
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            render={<Link href={DOCS_BASE_PATH} />}
          >
            <ArrowLeft className="size-3.5" />
            Docs
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="hidden text-xs sm:inline-flex"
            render={
              <a
                href="/openapi.json"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <FileJson className="size-3.5" />
            openapi.json
          </Button>
          <DocsThemeToggle />
        </div>
      </header>

      <main className="min-h-[calc(100dvh-3.25rem)]">
        <ScalarApiReference configuration={configuration} />
      </main>
    </div>
  );
}
