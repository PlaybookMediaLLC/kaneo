import type { CSSProperties, ReactNode } from "react";
import { brand } from "@kaneo/branding";
import { useTranslation } from "react-i18next";
import type { PortalBranding } from "../core/types";

export interface PortalShellProps {
  workspaceName: string;
  branding: PortalBranding;
  children: ReactNode;
  actions?: ReactNode;
}

export function PortalShell({
  workspaceName,
  branding,
  children,
  actions,
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

  return (
    // quills-web-allow C19: runtime workspace theme variables must stay scoped to the portal container.
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-background text-foreground"
      style={themeVariables}
    >
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
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
          {actions}
        </div>
      </header>
      {children}
      <footer className="mt-auto border-t border-border px-4 py-4 text-center text-sm text-muted-foreground">
        {t("core.poweredBy")} {brand.name}
      </footer>
    </div>
  );
}
