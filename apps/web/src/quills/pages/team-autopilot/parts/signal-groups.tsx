import { useTranslation } from "react-i18next";
import { teamHref } from "../../../team/team-href";
import { GroupedList, type ListGroup } from "../../../ui/inbox/grouped-list";
import { Button } from "../../../ui/upstream";
import type { Signal } from "./signal-detail";
import { SignalListRow } from "./signal-list-row";

export interface SignalGroupsProps {
  workspaceId: string;
  groups: readonly ListGroup<Signal>[];
  /** The keyboard highlight. */
  cursor: string | null;
  onOpen: (id: string) => void;
  /** Present when the API has more signals. */
  onLoadMore?: () => void;
  loadingMore: boolean;
}

/** The signals in their groups, and the button that loads more. */
export function SignalGroups({ groups, ...props }: SignalGroupsProps) {
  const { t } = useTranslation("quills");
  return (
    <>
      <GroupedList
        label={t("autopilot.title")}
        groups={groups}
        getKey={(signal) => signal.id}
        renderItem={(signal) => (
          <SignalListRow
            signal={signal}
            href={teamHref(props.workspaceId, "/autopilot")}
            selected={signal.id === props.cursor}
            onOpen={() => props.onOpen(signal.id)}
          />
        )}
      />
      {props.onLoadMore ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground"
          loading={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t("autopilot.loadMore")}
        </Button>
      ) : null}
    </>
  );
}
