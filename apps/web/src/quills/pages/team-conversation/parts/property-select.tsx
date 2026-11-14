import { PortalSelectContent } from "../../../ui/portal-select-content";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/upstream";

export interface PropertySelectProps {
  /** The accessible name, such as "Status". */
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** A compact picker for one conversation property, such as the status or the assignee. */
export function PropertySelect(props: PropertySelectProps) {
  return (
    <Select
      items={[...props.options]}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value !== null && value !== props.value) props.onChange(value);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={props.label}
        className="w-auto min-w-28 max-w-56"
      >
        <SelectValue />
      </SelectTrigger>
      <PortalSelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </PortalSelectContent>
    </Select>
  );
}
