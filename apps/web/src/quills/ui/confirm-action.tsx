import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./upstream";

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export interface ConfirmActionProps {
  labelKey: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  role?: "button" | "switch";
  checked?: boolean;
  "aria-checked"?: boolean;
  pressed?: boolean;
}

export function ConfirmAction({
  labelKey,
  onConfirm,
  disabled,
  role = "button",
  checked,
  "aria-checked": ariaChecked,
  pressed,
}: ConfirmActionProps) {
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
      <Button
        type="button"
        role={role}
        aria-checked={role === "switch" ? (ariaChecked ?? checked) : undefined}
        aria-pressed={pressed}
        disabled={disabled || pending}
        loading={pending}
        onClick={() => void confirm()}
      >
        {t(labelKey)}
      </Button>
    </div>
  );
}
