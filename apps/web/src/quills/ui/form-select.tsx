import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
  type PathValue,
} from "react-hook-form";
import { PortalSelectContent } from "./portal-select-content";
import {
  Field,
  FieldError,
  FieldLabel,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "./upstream";

export interface FormSelectProps<
  T extends FieldValues,
  N extends FieldPath<T>,
> {
  control: Control<T>;
  name: N;
  /** The label. The trigger gets its accessible name from it. */
  label: string;
  /** Hides the label from view. Screen readers still read it. */
  hideLabel?: boolean;
  /** An option with a null value is the empty choice, such as "Not set". */
  options: readonly { value: PathValue<T, N>; label: string }[];
  size?: "sm";
}

/** A coss Select that edits one react-hook-form field, with its label and its error. */
export function FormSelect<T extends FieldValues, N extends FieldPath<T>>(
  props: FormSelectProps<T, N>,
) {
  return (
    <Controller
      control={props.control}
      name={props.name}
      render={({ field, fieldState }) => (
        <Field invalid={Boolean(fieldState.error)}>
          <FieldLabel className={cn(props.hideLabel && "sr-only")}>
            {props.label}
          </FieldLabel>
          <Select
            items={props.options}
            value={field.value}
            onValueChange={field.onChange}
          >
            <SelectTrigger
              ref={field.ref}
              size={props.size}
              onBlur={field.onBlur}
            >
              <SelectValue />
            </SelectTrigger>
            <PortalSelectContent>
              <SelectGroup>
                {props.options.map((option) => (
                  <SelectItem key={String(option.value)} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </PortalSelectContent>
          </Select>
          {fieldState.error?.message ? (
            <FieldError match role="alert">
              {fieldState.error.message}
            </FieldError>
          ) : null}
        </Field>
      )}
    />
  );
}
