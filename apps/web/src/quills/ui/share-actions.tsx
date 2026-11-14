import {
  IconLinkOutline18,
  IconPaperPlane2Outline18,
} from "nucleo-ui-essential-outline-18";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface ShareActionsProps {
  className?: string;
  /** One share pill that copies the link when the browser cannot share. */
  compact?: boolean;
}

const action =
  "flex w-full items-center gap-2 rounded-md py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground";

/** Copy or share the current page address. */
export function ShareActions({ className, compact }: ShareActionsProps) {
  const { t } = useTranslation("quills");
  const [message, setMessage] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage(t("core.linkCopied"));
    } catch {
      setMessage(t("core.copyFailed"));
    }
  };
  const share = async () => {
    try {
      await navigator.share({
        title: document.title,
        url: window.location.href,
      });
      setMessage("");
    } catch (error) {
      if ((error as Error)?.name !== "AbortError")
        setMessage(t("core.shareFailed"));
    }
  };
  const live = (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {message}
    </p>
  );
  if (compact)
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        {live}
        <button
          type="button"
          className="rounded-full bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/70"
          onClick={() =>
            void (typeof navigator.share === "function" ? share() : copy())
          }
        >
          {t("core.share")}
        </button>
      </div>
    );
  return (
    <div className={className}>
      <ul className="grid gap-0.5">
        <li>
          <button type="button" className={action} onClick={() => void copy()}>
            <IconLinkOutline18 aria-hidden="true" className="size-3.5" />
            {t("core.copyLink")}
          </button>
        </li>
        <li>
          <button type="button" className={action} onClick={() => void share()}>
            <IconPaperPlane2Outline18 aria-hidden="true" className="size-3.5" />
            {t("core.share")}
          </button>
        </li>
      </ul>
      <div className="mt-1 max-w-44">{live}</div>
    </div>
  );
}
