import { ArrowLeft, ChevronDown, ChevronUp, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  SheetTrigger,
} from "../upstream";
import { useListNavigation } from "./use-list-navigation";

export interface DetailLayoutProps {
  /** The compact list (ListRow with `compact`). Hidden below md. */
  list: ReactNode;
  listLabel: string;
  /** The IDs of the compact list in order, for J, K and the arrow keys. */
  ids: readonly string[];
  activeId: string;
  /** Opens another item of the list. */
  onMove: (id: string) => void;
  /** Esc and the back button: return to the list. */
  onBack: () => void;
  /** The open item: its header, its thread and the ActionBar. */
  children: ReactNode;
  /** The properties panel (PropertyRow items). A sheet below lg. */
  properties: ReactNode;
  propertiesLabel: string;
}

/** The three panes of an open inbox item (RFC 0004 D3): compact list, item and properties. */
export function DetailLayout(props: DetailLayoutProps) {
  const { t } = useTranslation("quills");
  const { next, previous } = useListNavigation(props);
  const step = [
    { key: "k", labelKey: "inbox.previous", icon: ChevronUp, run: previous },
    { key: "j", labelKey: "inbox.next", icon: ChevronDown, run: next },
  ] as const;
  return (
    <div data-slot="detail-layout" className="flex h-full min-h-0">
      <section
        aria-label={props.listLabel}
        className="hidden w-72 shrink-0 overflow-y-auto border-e border-border md:block"
      >
        {props.list}
      </section>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("inbox.back")}
            aria-keyshortcuts="Escape"
            onClick={props.onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          {step.map(({ key, labelKey, icon: Icon, run }) => (
            <Button
              key={key}
              variant="ghost"
              size="icon-sm"
              aria-label={t(labelKey)}
              aria-keyshortcuts={key.toUpperCase()}
              onClick={run}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
          <Sheet>
            <SheetTrigger
              render={<Button variant="ghost" size="sm" />}
              className="ms-auto lg:hidden"
            >
              <PanelRight aria-hidden="true" />
              {props.propertiesLabel}
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{props.propertiesLabel}</SheetTitle>
              </SheetHeader>
              <SheetPanel>{props.properties}</SheetPanel>
            </SheetContent>
          </Sheet>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
      </div>
      <aside
        aria-label={props.propertiesLabel}
        className="hidden w-80 shrink-0 overflow-y-auto border-s border-border px-4 py-3 lg:block"
      >
        {props.properties}
      </aside>
    </div>
  );
}
