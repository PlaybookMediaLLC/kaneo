import { PanelLeftOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  cn,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../upstream";
import { DetailPaneContext } from "./detail-pane-context";
import { IconButton } from "./icon-button";

export interface DetailLayoutProps {
  /** The list pane (ListPane), about 360 px wide. Hidden below md while an item is open. */
  list: ReactNode;
  listLabel: string;
  /** False when no item is open: below md the list then fills the screen. */
  itemOpen?: boolean;
  /** The main pane: DetailHeader, the thread and the composer, or EmptySelection. */
  children: ReactNode;
  /** The right panel (PropertyRow items). DetailHeader shows its toggle; below lg it is a sheet. */
  properties?: ReactNode;
  propertiesLabel?: string;
}

const wide = () => window.matchMedia?.("(min-width: 64rem)").matches ?? true;

/**
 * The panes of the conversation, ticket and request views (design section 2): the list pane,
 * the main pane and the right panel. The list pane and the panel can be hidden.
 */
export function DetailLayout({
  list,
  listLabel,
  itemOpen = true,
  children,
  properties,
  propertiesLabel = "",
}: DetailLayoutProps) {
  const { t } = useTranslation("quills");
  const [listOpen, setListOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const panel = properties
    ? {
        label: propertiesLabel,
        open: panelOpen,
        toggle: () =>
          wide() ? setPanelOpen((open) => !open) : setSheetOpen(true),
      }
    : null;
  return (
    <DetailPaneContext.Provider
      value={{ hideList: () => setListOpen(false), panel }}
    >
      <div data-slot="detail-layout" className="flex h-full min-h-0">
        {listOpen ? (
          <section
            aria-label={listLabel}
            className={cn(
              "min-h-0 w-full shrink-0 flex-col border-e border-border md:flex md:w-90",
              itemOpen ? "hidden" : "flex",
            )}
          >
            {list}
          </section>
        ) : (
          <div className="hidden shrink-0 border-e border-border p-2 md:block">
            <IconButton
              label={t("inbox.showList")}
              onClick={() => setListOpen(true)}
            >
              <PanelLeftOpen aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col",
            itemOpen ? "flex" : "hidden md:flex",
          )}
        >
          {children}
        </div>
        {properties && panelOpen ? (
          <aside
            aria-label={propertiesLabel}
            className="hidden w-80 shrink-0 overflow-y-auto border-s border-border px-5 py-4 lg:block"
          >
            {properties}
          </aside>
        ) : null}
        {properties ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{propertiesLabel}</SheetTitle>
              </SheetHeader>
              <SheetPanel>{properties}</SheetPanel>
            </SheetContent>
          </Sheet>
        ) : null}
      </div>
    </DetailPaneContext.Provider>
  );
}
