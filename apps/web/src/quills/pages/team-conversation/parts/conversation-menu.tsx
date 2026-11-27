import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  ArchiveRestore,
  Ban,
  CheckCircle2,
  CircleSlash,
  EllipsisVertical,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../ui/inbox/icon-button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../../../ui/upstream";
import type { ConversationStatus } from "../../team-conversations/conversation-list";

export interface ConversationMenuProps {
  status: ConversationStatus;
  /** Ended as spam. */
  spam: boolean;
  archived: boolean;
  /** Whether the sender is blocked; null when the sender has no customer profile. */
  blocked: boolean | null;
  /** Whether the sender's address is blocked; null when no address was recorded. */
  ipBlocked?: boolean | null;
  disabled?: boolean;
  onOfferSolution?: () => void;
  onSnooze: () => void;
  /** Reopens a snoozed conversation. */
  onUnsnooze: () => void;
  onSpam: () => void;
  onNotSpam: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onBlockIp?: () => void;
  onUnblockIp?: () => void;
}

/**
 * The kebab menu of the conversation header: offer solution, snooze or unsnooze, spam, archive and blocking.
 * Archive is apart from the status: it only takes the conversation out of the inbox lists.
 */
export function ConversationMenu(props: ConversationMenuProps) {
  const { t } = useTranslation("quills");
  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            disabled={props.disabled}
            label={t("team-conversations.more")}
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {props.status === "open" && props.onOfferSolution ? (
          <MenuItem onClick={props.onOfferSolution}>
            <CheckCircle2 aria-hidden="true" />
            {t("team-conversations.offerSolution")}
          </MenuItem>
        ) : null}
        {props.status === "open" ? (
          <MenuItem onClick={props.onSnooze}>
            <AlarmClock aria-hidden="true" />
            {t("team-conversations.snooze")}
          </MenuItem>
        ) : null}
        {props.status === "snoozed" ? (
          <MenuItem onClick={props.onUnsnooze}>
            <AlarmClockOff aria-hidden="true" />
            {t("team-conversations.unsnooze")}
          </MenuItem>
        ) : null}
        {props.spam ? (
          <MenuItem onClick={props.onNotSpam}>
            <ShieldCheck aria-hidden="true" />
            {t("team-conversations.notSpam")}
          </MenuItem>
        ) : (
          <MenuItem onClick={props.onSpam}>
            <ShieldAlert aria-hidden="true" />
            {t("team-conversations.markSpam")}
          </MenuItem>
        )}
        {props.archived ? (
          <MenuItem onClick={props.onUnarchive}>
            <ArchiveRestore aria-hidden="true" />
            {t("team-conversations.unarchive")}
          </MenuItem>
        ) : (
          <MenuItem onClick={props.onArchive}>
            <Archive aria-hidden="true" />
            {t("team-conversations.archive")}
          </MenuItem>
        )}
        {props.blocked === null ? null : (
          <>
            <MenuSeparator />
            {props.blocked ? (
              <MenuItem onClick={props.onUnblock}>
                <CircleSlash aria-hidden="true" />
                {t("team-conversations.unblock")}
              </MenuItem>
            ) : (
              <MenuItem variant="destructive" onClick={props.onBlock}>
                <Ban aria-hidden="true" />
                {t("team-conversations.block")}
              </MenuItem>
            )}
          </>
        )}
        {props.ipBlocked === null || props.ipBlocked === undefined ? null : (
          <>
            <MenuSeparator />
            {props.ipBlocked ? (
              <MenuItem onClick={props.onUnblockIp}>
                <CircleSlash aria-hidden="true" />
                {t("team-conversations.unblockIp")}
              </MenuItem>
            ) : (
              <MenuItem variant="destructive" onClick={props.onBlockIp}>
                <Ban aria-hidden="true" />
                {t("team-conversations.blockIp")}
              </MenuItem>
            )}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
