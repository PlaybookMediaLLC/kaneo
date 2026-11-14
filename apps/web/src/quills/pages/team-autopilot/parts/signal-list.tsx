import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ListHeader } from "../../../ui/inbox/list-header";
import {
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../../ui/upstream";
import type { Signal } from "./signal-detail";

export interface SignalListProps {
  status: Signal["status"];
  onStatusChange: (status: Signal["status"]) => void;
  /** The result of the last decision. */
  message: string;
  /** The list in its query state. */
  children: ReactNode;
}

const filters = {
  pending: { labelKey: "autopilot.pending", titleKey: "autopilot.title" },
  accepted: {
    labelKey: "autopilot.accepted",
    titleKey: "autopilot.titleAccepted",
  },
  dismissed: {
    labelKey: "autopilot.dismissed",
    titleKey: "autopilot.titleDismissed",
  },
} as const;

/** The autopilot list view: the header with the status filter, and a scroll area for the signals. */
export function SignalList(props: SignalListProps) {
  const { t } = useTranslation("quills");
  return (
    <>
      <ListHeader
        title={t(filters[props.status].titleKey)}
        filters={
          <MenuRadioGroup
            value={props.status}
            onValueChange={(value) =>
              props.onStatusChange(value as Signal["status"])
            }
          >
            <MenuGroupLabel>{t("autopilot.filter")}</MenuGroupLabel>
            {(Object.keys(filters) as Signal["status"][]).map((value) => (
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
