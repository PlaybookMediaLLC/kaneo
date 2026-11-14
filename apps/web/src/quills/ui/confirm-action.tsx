import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Label, Switch } from "./upstream";

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export interface ConfirmActionProps {
  labelKey: string;
  /** Values for the label, such as the emoji of a reaction. */
  labelValues?: Record<string, string | number>;
  children?: ReactNode;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  role?: "button" | "switch";
  checked?: boolean;
  "aria-checked"?: boolean;
  pressed?: boolean;
  className?: string;
}

export function ConfirmAction({
  labelKey,
  labelValues,
  children,
  onConfirm,
  disabled,
  role = "button",
  checked,
  "aria-checked": ariaChecked,
  pressed,
  className,
}: ConfirmActionProps) {
  const id = useId();
  const { t } = useTranslation("quills");
  const [pending, setPending] = useState(false);
  const [frameBlocked, setFrameBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const confirm = async () => {
    if (running.current || disabled) return;
    if (isFramed()) {
      setFrameBlocked(true);
      return;
    }
    running.current = true;
    setFailed(false);
    setPending(true);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return (
    <div>
      {frameBlocked ? <p role="alert">{t("core.frameBlocked")}</p> : null}
      {failed ? <p role="alert">{t("core.problem.failed")}</p> : null}
      {role === "switch" ? (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={id}>{t(labelKey)}</Label>
          <Switch
            id={id}
            checked={ariaChecked ?? checked ?? false}
            disabled={disabled || pending}
            onCheckedChange={() => void confirm()}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant={
            pressed === undefined
              ? "default"
              : pressed
                ? "secondary"
                : "outline"
          }
          aria-label={children ? t(labelKey, labelValues) : undefined}
          aria-pressed={pressed}
          className={className}
          disabled={disabled || pending}
          loading={pending}
          onClick={() => void confirm()}
        >
          {children ?? t(labelKey)}
        </Button>
      )}
    </div>
  );
}
