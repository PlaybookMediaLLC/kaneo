import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ListHeader } from "../../../ui/inbox/list-header";
import { StatusTabs } from "../../../ui/inbox/status-tabs";
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
  pending: "autopilot.pending",
  accepted: "autopilot.accepted",
  dismissed: "autopilot.dismissed",
} as const;

/** The autopilot list view: the header, the status tabs and a scroll area for the signals. */
export function SignalList(props: SignalListProps) {
  const { t } = useTranslation("quills");
  return (
    <>
      <ListHeader title={t("autopilot.title")} />
      <StatusTabs
        label={t("autopilot.filter")}
        tabs={(Object.keys(filters) as Signal["status"][]).map((value) => ({
          value,
          label: t(filters[value]),
        }))}
        value={props.status}
        onChange={(value) => props.onStatusChange(value as Signal["status"])}
      />
      {/* The loading, empty and error states get a margin. */}
      <div className="min-h-0 flex-1 overflow-y-auto [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
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
