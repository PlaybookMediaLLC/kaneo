import { ConfirmAction } from "../../../ui/confirm-action";

export interface PreferenceToggleProps {
  labelKey: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => Promise<void>;
}

export function PreferenceToggle(props: PreferenceToggleProps) {
  return (
    <div className="rounded-xl border border-border p-4">
      <ConfirmAction
        labelKey={props.labelKey}
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onConfirm={() => props.onChange(!props.checked)}
      />
    </div>
  );
}
