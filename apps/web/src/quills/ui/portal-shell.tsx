import type { CSSProperties, ReactNode } from "react";
import { brand } from "@kaneo/branding";
import { useTranslation } from "react-i18next";
import { PortalThemeContext } from "../core/portal-theme-context";
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
  const theme =
    branding.theme.themeMode === "dark" ||
    (branding.theme.themeMode === "user" &&
      document.documentElement.classList.contains("dark"))
      ? branding.theme.dark
      : branding.theme.light;
  const themeVariables = Object.fromEntries(
    Object.entries(theme).map(([key, value]) => [
      `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    ]),
  ) as CSSProperties;

  const shell = (
    // quills-web-allow C19: runtime workspace theme variables must stay scoped to the portal container.
    <div
      className="portal-shell break-words flex h-full min-h-0 w-full flex-col overflow-y-auto bg-background text-foreground font-sans text-sm leading-relaxed [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
      style={themeVariables}
    >
      <header className="portal-header shrink-0 bg-background">
        <div className="portal-header-inner mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-5 md:gap-8 md:px-8 lg:flex-nowrap">
          <div className="portal-brand flex min-w-0 flex-1 items-center gap-2 text-base tracking-tight lg:flex-none">
            {branding.logoUrl ? (
              <img
                className="max-h-8 max-w-32 object-contain"
                src={branding.logoUrl}
                alt={displayName}
              />
            ) : null}
            {branding.headerDisplayMode === "logo_and_name" ||
            !branding.logoUrl ? (
              <span className="truncate font-semibold">{displayName}</span>
            ) : null}
          </div>
          {navigation}
          <div className="portal-account-actions ml-auto flex items-center gap-2 text-xs [&_a]:rounded-full [&_a]:px-3 [&_a]:py-2 [&_a]:text-muted-foreground [&_a:hover]:text-foreground">
            {actions}
          </div>
        </div>
      </header>
      {children}
      <footer className="portal-footer mx-auto w-full max-w-6xl px-5 py-6 text-xs text-muted-foreground md:px-8">
        {t("core.poweredBy")} {brand.name}
      </footer>
    </div>
  );
  return (
    <PortalThemeContext value={themeVariables}>{shell}</PortalThemeContext>
  );
}
