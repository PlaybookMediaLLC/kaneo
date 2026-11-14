import { Fragment } from "react";
import { useTranslation } from "react-i18next";

export interface HelpBreadcrumbProps {
  items: Array<{ label: string; href: string }>;
}

/** The path above a help page title; the current page is the title itself. */
export function HelpBreadcrumb({ items }: HelpBreadcrumbProps) {
  const { t } = useTranslation("quills");
  return (
    <nav aria-label={t("core.breadcrumb")} className="mb-3 text-xs">
      <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {items.map((item, index) => (
          <Fragment key={item.href}>
            {index ? (
              <li aria-hidden="true" className="text-border">
                {t("core.breadcrumbSeparator")}
              </li>
            ) : null}
            <li>
              <a className="hover:text-foreground" href={item.href}>
                {item.label}
              </a>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
