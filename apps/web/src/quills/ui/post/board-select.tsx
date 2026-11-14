import { IconCircleHashtagOutline18 } from "nucleo-ui-essential-outline-18";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { PortalSelectContent } from "../portal-select-content";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../upstream";

export interface BoardSelectProps {
  name: string;
  boards: Array<{ id: string; name: string }>;
  value: string | undefined;
  triggerRef?: Ref<HTMLButtonElement>;
  onChange: (boardId: string) => void;
}

/** A compact "# Board" picker for a composer footer. */
export function BoardSelect(props: BoardSelectProps) {
  const { t } = useTranslation("quills");
  const items = props.boards.map((board) => ({
    value: board.id,
    label: board.name,
  }));
  return (
    <Select
      name={props.name}
      items={items}
      value={props.value ?? null}
      onValueChange={(value) => {
        if (value !== null) props.onChange(value);
      }}
    >
      <SelectTrigger
        ref={props.triggerRef}
        aria-label={t("feedback.board")}
        className="min-h-7 w-auto min-w-0 gap-1 rounded-md border-0 bg-muted/60 px-2 text-xs shadow-none before:hidden sm:min-h-7 sm:text-xs dark:bg-muted/60 [&_svg]:size-3"
      >
        <IconCircleHashtagOutline18 aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <PortalSelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </PortalSelectContent>
    </Select>
  );
}
