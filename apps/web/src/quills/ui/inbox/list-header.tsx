import { ListFilter } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Menu, MenuPopup, MenuTrigger } from "../upstream";
import { useKeyShortcuts } from "./use-key-shortcuts";

export interface ListHeaderProps {
  title: string;
  /** 2 when the page already has an h1, such as a list pane beside an open item. */
  headingLevel?: 1 | 2;
  /** The filter menu items (MenuCheckboxItem, MenuItem, MenuSeparator). The button and F open it. */
  filters?: ReactNode;
  /** A filter button that runs a handler instead of a menu. Ignored with `filters`. */
  onFilters?: () => void;
  /** Controls after the filter button: a search field, pill buttons, the black create button. */
  actions?: ReactNode;
}

/** The title row of a page or list pane: the heading on the left, filters and actions on the right. */
export function ListHeader({
  title,
  headingLevel = 1,
  filters,
  onFilters,
  actions,
}: ListHeaderProps) {
  const { t } = useTranslation("quills");
  const [open, setOpen] = useState(false);
  const openFilters = filters ? () => setOpen(true) : onFilters;
  useKeyShortcuts({ f: openFilters });
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const button = {
    variant: "ghost",
    size: "icon-sm",
    "aria-label": t("inbox.filters"),
    "aria-keyshortcuts": "F",
  } as const;
  const icon = <ListFilter aria-hidden="true" />;
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2.5">
      <Heading
        tabIndex={-1}
        className="min-w-0 flex-1 truncate text-lg font-semibold outline-none"
      >
        {title}
      </Heading>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {filters ? (
          <Menu open={open} onOpenChange={setOpen}>
            <MenuTrigger render={<Button {...button} />}>{icon}</MenuTrigger>
            <MenuPopup align="end">{filters}</MenuPopup>
          </Menu>
        ) : onFilters ? (
          <Button {...button} onClick={onFilters}>
            {icon}
          </Button>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
