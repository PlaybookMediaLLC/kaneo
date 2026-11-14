import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { teamHref } from "../../../team/team-href";
import { TeamStateView } from "../../../team/team-state-view";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { DetailLayout } from "../../../ui/inbox/detail-layout";
import { ListPane } from "../../../ui/inbox/list-pane";
import { useListNavigation } from "../../../ui/inbox/use-list-navigation";
import { SignalActions, type SignalActionsProps } from "./signal-actions";
import { SignalDetail, type Signal } from "./signal-detail";
import { SignalListRow } from "./signal-list-row";
import { SignalProperties } from "./signal-properties";

export interface SignalViewProps {
  workspaceId: string;
  signal: Signal;
  /** The signals of the list in display order, for the compact list. */
  signals: readonly Signal[];
  /** The result of the last decision. */
  message: string;
  /** The problem of the last decision. */
  problem: PortalProblem | null;
  onMove: (id: string) => void;
  onBack: () => void;
  actions: Omit<SignalActionsProps, "signal">;
}

/** The open signal in three panes: the compact list, the signal with its decisions, and its properties. */
export function SignalView({ signal, signals, ...props }: SignalViewProps) {
  const { t } = useTranslation("quills");
  const nav = useListNavigation({
    ids: signals.map((item) => item.id),
    activeId: signal.id,
    onMove: props.onMove,
    onBack: props.onBack,
  });
  return (
    <DetailLayout
      list={
        <ListPane title={t("autopilot.title")} headingLevel={2}>
          <ul className="grid gap-0.5">
            {signals.map((item) => (
              <li key={item.id}>
                <SignalListRow
                  signal={item}
                  href={teamHref(props.workspaceId, "/autopilot")}
                  compact
                  selected={item.id === signal.id}
                  onOpen={() => props.onMove(item.id)}
                />
              </li>
            ))}
          </ul>
        </ListPane>
      }
      listLabel={t("autopilot.title")}
      properties={
        <SignalProperties workspaceId={props.workspaceId} signal={signal} />
      }
      propertiesLabel={t("autopilot.properties")}
    >
      <DetailHeader
        onBack={props.onBack}
        onPrevious={nav.previous}
        onNext={nav.next}
      >
        <div className="min-w-0">
          <h1
            tabIndex={-1}
            className="line-clamp-2 text-lg font-semibold leading-tight outline-none"
          >
            {signal.suggestedTitle}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {signal.customer.displayName
              ? t("autopilot.from", { name: signal.customer.displayName })
              : t("autopilot.anonymous")}
          </p>
        </div>
      </DetailHeader>
      <SignalDetail signal={signal} />
      <p
        role="status"
        className="px-6 text-sm text-muted-foreground [&:not(:empty)]:pb-2"
      >
        {props.message}
      </p>
      <div className="px-6">
        <TeamStateView problem={props.problem}>{null}</TeamStateView>
      </div>
      <div className="grow" />
      <SignalActions signal={signal} {...props.actions} />
    </DetailLayout>
  );
}
