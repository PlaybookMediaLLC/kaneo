import { PortalSelectContent } from "../../../ui/portal-select-content";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/upstream";

export interface TicketSelectProps {
  /** The accessible name, such as "Status". */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** A compact picker of one ticket property, such as the status, the assignee or the priority. */
export function TicketSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: TicketSelectProps) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && next !== value) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="sm" className="w-auto min-w-32">
        <SelectValue />
      </SelectTrigger>
      <PortalSelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </PortalSelectContent>
    </Select>
  );
}
