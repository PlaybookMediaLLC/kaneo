import {
  AlarmClock,
  Ban,
  CircleSlash,
  EllipsisVertical,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
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
  /** Whether the sender is blocked; null when the sender has no customer profile. */
  blocked: boolean | null;
  disabled?: boolean;
  onSnooze: () => void;
  onSpam: () => void;
  onNotSpam: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}

/**
 * The kebab menu of the conversation header: snooze, spam and blocking. The API has no
 * conversation archive, so the menu has no Archive item.
 */
export function ConversationMenu(props: ConversationMenuProps) {
  const { t } = useTranslation("quills");
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={props.disabled}
            aria-label={t("team-conversations.more")}
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        {props.status === "open" ? (
          <MenuItem onClick={props.onSnooze}>
            <AlarmClock aria-hidden="true" />
            {t("team-conversations.snooze")}
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
      </MenuPopup>
    </Menu>
  );
}
