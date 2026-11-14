import { ListFilter, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Kbd } from "../upstream";
import { useKeyShortcuts } from "./use-key-shortcuts";

export interface ListHeaderProps {
  title: string;
  /** Opens the filters. The button and the F key exist only with a handler. */
  onFilters?: () => void;
  /** Opens the display options. The button and the V key exist only with a handler. */
  onDisplay?: () => void;
  /** More controls at the end of the row, such as a create button. */
  actions?: ReactNode;
  /** 2 when the page already has an h1, such as a demo inside another page. */
  headingLevel?: 1 | 2;
}

const controls = [
  { key: "f", labelKey: "inbox.filters", icon: ListFilter },
  { key: "v", labelKey: "inbox.display", icon: SlidersHorizontal },
] as const;

/** The title row of an inbox list: the page heading, Filters (F) and Display (V). */
export function ListHeader({
  title,
  onFilters,
  onDisplay,
  actions,
  headingLevel = 1,
}: ListHeaderProps) {
  const { t } = useTranslation("quills");
  const handlers = { f: onFilters, v: onDisplay };
  useKeyShortcuts(handlers);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <Heading
        tabIndex={-1}
        className="min-w-0 truncate text-base font-semibold outline-none"
      >
        {title}
      </Heading>
      <div className="flex items-center gap-1">
        {controls.map(({ key, labelKey, icon: Icon }) =>
          handlers[key] ? (
            <Button
              key={key}
              variant="ghost"
              size="sm"
              aria-keyshortcuts={key.toUpperCase()}
              onClick={handlers[key]}
            >
              <Icon aria-hidden="true" />
              {t(labelKey)}
              <Kbd aria-hidden="true" tone="muted">
                {key.toUpperCase()}
              </Kbd>
            </Button>
          ) : null,
        )}
        {actions}
      </div>
    </div>
  );
}
