import { useTranslation } from "react-i18next";
import { plainText } from "../../../core/plain-text";
import { RequestRow } from "../../../ui/inbox/request-row";
import type { Signal } from "./signal-detail";

export interface SignalListRowProps {
  signal: Signal;
  href: string;
  onOpen: () => void;
  selected?: boolean;
  compact?: boolean;
}

/** One signal in the autopilot list: the customer, the suggested title, the words and the source. */
export function SignalListRow({ signal, ...row }: SignalListRowProps) {
  const { t } = useTranslation("quills");
  const { source } = signal;
  return (
    <RequestRow
      {...row}
      person={{
        name: signal.customer.displayName ?? t("autopilot.anonymousName"),
      }}
      title={signal.suggestedTitle}
      detail={plainText(signal.excerpt)}
      badges={[
        {
          id: source.type,
          label:
            source.type === "conversation"
              ? t("autopilot.conversation")
              : t("autopilot.ticket", { number: source.number }),
        },
      ]}
      time={signal.createdAt}
    />
  );
}
