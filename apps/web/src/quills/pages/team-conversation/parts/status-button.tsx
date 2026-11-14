import { Check, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../ui/upstream";
import type { ConversationStatus } from "../../team-conversations/conversation-list";

export interface StatusButtonProps {
  status: ConversationStatus;
  disabled?: boolean;
  onResolve: () => void;
  onReopen: () => void;
}

/** "Resolve" for an open or snoozed conversation; a green "Resolved" pill that reopens a closed one. */
export function StatusButton(props: StatusButtonProps) {
  const { t } = useTranslation("quills");
  return props.status === "closed" ? (
    <Button
      size="sm"
      className="rounded-full border-success bg-success text-white hover:bg-success/90"
      disabled={props.disabled}
      aria-label={t("team-conversations.reopenResolved")}
      onClick={props.onReopen}
    >
      <CircleCheck aria-hidden="true" />
      {t("team-conversations.status.closed")}
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={props.disabled}
      onClick={props.onResolve}
    >
      <Check aria-hidden="true" />
      {t("team-conversations.resolve")}
    </Button>
  );
}
