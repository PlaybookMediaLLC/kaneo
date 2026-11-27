import type { CSSProperties, ReactNode } from "react";
import { brand } from "@kaneo/branding";
import { useTranslation } from "react-i18next";
import { ensurePortalThemeContrast } from "../core/contrast";
import { PortalThemeContext } from "../core/portal-theme-context";
import { useDarkTheme } from "../core/use-dark-theme";
import type { PortalBranding } from "../core/types";

export interface PortalShellProps {
  workspaceName: string;
  branding: PortalBranding;
  children: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
}

export function PortalShell({
  workspaceName,
  branding,
  children,
  actions,
  navigation,
}: PortalShellProps) {
  const { t } = useTranslation("quills");
  const displayName = branding.headerDisplayName?.trim() || workspaceName;
  const dark = useDarkTheme();
  const rawTheme =
    branding.theme.themeMode === "dark" ||
    (branding.theme.themeMode === "user" && dark)
      ? branding.theme.dark
      : branding.theme.light;
  const theme = ensurePortalThemeContrast(
    rawTheme as unknown as Record<string, string>,
  );
  const themeVariables = Object.fromEntries(
    Object.entries(theme).map(([key, value]) => [
      `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    ]),
  ) as CSSProperties;

  const shell = (
    // quills-web-allow C19: runtime workspace theme variables must stay scoped to the portal container.
    <div
      className="portal-shell break-words flex h-full min-h-0 w-full scroll-pt-28 flex-col overflow-y-auto bg-background lg:scroll-pt-20 text-foreground font-sans text-sm leading-relaxed [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
      style={themeVariables}
    >
      <a
        href="#portal-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-2 focus:outline-offset-2 focus:outline-ring"
      >
        {t("core.skipToContent")}
      </a>
      <header className="portal-header sticky top-0 z-20 shrink-0 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="portal-header-inner mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-4 lg:flex-nowrap lg:gap-6">
          <div className="portal-brand flex min-w-0 flex-1 items-center gap-2 text-base tracking-tight lg:flex-none">
            {branding.logoUrl ? (
              <img
                className="h-auto max-h-8 w-auto max-w-32 object-contain"
                src={branding.logoUrl}
                alt={displayName}
                width={128}
                height={32}
                decoding="async"
              />
            ) : null}
            {branding.headerDisplayMode === "logo_and_name" ||
            !branding.logoUrl ? (
              <span className="truncate font-semibold">{displayName}</span>
            ) : null}
          </div>
          {navigation}
          <div className="portal-account-actions ms-auto flex items-center gap-1.5 text-sm [&_a]:whitespace-nowrap [&_a]:rounded-full [&_a]:px-3 [&_a]:py-1.5 [&_a]:font-medium">
            {actions}
          </div>
        </div>
      </header>
      <main
        id="portal-main-content"
        tabIndex={-1}
        className="flex-1 outline-none"
      >
        {children}
      </main>
      <footer className="portal-footer mx-auto w-full max-w-5xl px-5 py-6 text-xs text-muted-foreground max-sm:pb-24">
        {t("core.poweredBy")} {brand.name}
      </footer>
    </div>
  );
  return (
    <PortalThemeContext value={themeVariables}>{shell}</PortalThemeContext>
  );
}
