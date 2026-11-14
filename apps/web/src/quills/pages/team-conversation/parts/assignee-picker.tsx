import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  Button,
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../../../ui/upstream";
import type { Teammate } from "../../team-conversations/conversation-list";

export interface AssigneePickerProps {
  /** The assigned teammate's principal ID, or null. */
  value: string | null;
  people: readonly Teammate[];
  /** The caller's principal: the pill reads "You" when it is assigned. */
  myPrincipalId: string | null;
  disabled?: boolean;
  onChange: (principalId: string | null) => void;
}

const NOBODY = "none";

/** The assignee pill of the conversation header: "You", a teammate or "Assign", and a teammate picker. */
export function AssigneePicker(props: AssigneePickerProps) {
  const { t } = useTranslation("quills");
  const person = props.people.find((item) => item.id === props.value);
  const label = !props.value
    ? t("team-conversations.assign")
    : props.value === props.myPrincipalId
      ? t("team-conversations.you")
      : (person?.name ?? t("team-conversations.unknown"));
  const current = props.value ?? NOBODY;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={props.disabled}
            aria-label={t("team-conversations.assignee", { name: label })}
          />
        }
      >
        {props.value ? (
          <PersonAvatar
            colored
            name={person?.name ?? null}
            avatarUrl={person?.avatarUrl}
          />
        ) : (
          <UserRound aria-hidden="true" />
        )}
        {label}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (String(value) !== current)
              props.onChange(value === NOBODY ? null : String(value));
          }}
        >
          <MenuRadioItem value={NOBODY}>
            {t("team-conversations.unassigned")}
          </MenuRadioItem>
          {props.people.map((item) => (
            <MenuRadioItem key={item.id} value={item.id}>
              <span className="flex items-center gap-2">
                <PersonAvatar
                  colored
                  name={item.name}
                  avatarUrl={item.avatarUrl}
                />
                {item.id === props.myPrincipalId
                  ? t("team-conversations.youName", { name: item.name ?? "" })
                  : (item.name ?? t("team-conversations.unknown"))}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
