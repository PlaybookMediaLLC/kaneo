import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ListHeader } from "../../../ui/inbox/list-header";
import {
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../../ui/upstream";

/** The pairs that the list can show. */
export type SuggestionFilter = "pending" | "dismissed";

export interface SuggestionListProps {
  status: SuggestionFilter;
  onStatusChange: (status: SuggestionFilter) => void;
  /** The result of the last decision. */
  message: string;
  /** The list in its query state. */
  children: ReactNode;
}

const filters = {
  pending: { labelKey: "duplicates.pending", titleKey: "duplicates.title" },
  dismissed: {
    labelKey: "duplicates.dismissed",
    titleKey: "duplicates.titleDismissed",
  },
} as const;

/** The duplicates list view: the header with the status filter, and a scroll area for the pairs. */
export function SuggestionList(props: SuggestionListProps) {
  const { t } = useTranslation("quills");
  return (
    <>
      <ListHeader
        title={t(filters[props.status].titleKey)}
        filters={
          <MenuRadioGroup
            value={props.status}
            onValueChange={(value) =>
              props.onStatusChange(value as SuggestionFilter)
            }
          >
            <MenuGroupLabel>{t("duplicates.filter")}</MenuGroupLabel>
            {(Object.keys(filters) as SuggestionFilter[]).map((value) => (
              <MenuRadioItem key={value} value={value}>
                {t(filters[value].labelKey)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        }
      />
      {/* The loading, empty and error states get a margin. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
        <p
          role="status"
          className="text-sm text-muted-foreground [&:not(:empty)]:py-2"
        >
          {props.message}
        </p>
        {props.children}
      </div>
    </>
  );
}
