import { ArrowUp, Lock } from "lucide-react";
import type { ClipboardEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button, cn, Textarea } from "../upstream";
import { IconButton } from "./icon-button";
import type { ComposerMode } from "./inbox-types";

export interface ComposerProps {
  /** The accessible name and the placeholder, such as "Reply to Ada…". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Runs on Enter and on the send button when the text is not empty. */
  onSend: () => void;
  /** The choices of the mode bar, such as Reply and Note, or Public and Private. */
  modes?: readonly ComposerMode[];
  mode?: string;
  onModeChange?: (mode: string) => void;
  /** Buttons at the start of the toolbar, such as attach and emoji. */
  tools?: ReactNode;
  /** Optional extra controls beside the send button (such as schedule send). */
  sendExtra?: ReactNode;
  /** Optional warning or collision banner rendered directly inside the top of the composer. */
  banner?: ReactNode;
  /** Optional paste handler for clipboard images / screenshots (#326). */
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  sending?: boolean;
  disabled?: boolean;
  /** The text box, so that R and N can focus it. */
  inputRef?: Ref<HTMLTextAreaElement>;
}

/**
 * The rounded message box at the bottom of a thread. Enter sends; Shift+Enter adds a line.
 * Public reply and internal note modes use distinct chrome (segmented mode tabs, persistent
 * context label, dashed left accent border + lock icon, and explicit button text) so notes
 * cannot be mistaken for customer replies even without color perception (#324).
 */
export function Composer(props: ComposerProps) {
  const { t } = useTranslation("quills");
  const current =
    props.modes?.find((mode) => mode.value === props.mode) ?? props.modes?.[0];
  const ready =
    Boolean(props.value.trim()) && !props.sending && !props.disabled;
  const send = () => {
    if (ready) props.onSend();
  };
  const SendIcon = current?.sendIcon ?? (current?.private ? Lock : ArrowUp);
  const showModeBar = Boolean(props.modes && props.modes.length > 1);
  const showContextStrip = Boolean(current?.description || showModeBar);

  return (
    <div
      data-composer-mode={current?.value ?? "default"}
      data-composer-private={current?.private ? "true" : "false"}
      className={cn(
        // A lifted card: a soft deep shadow, and a quiet border that darkens while typing.
        "rounded-xl border border-border bg-card p-2 shadow-[0_1px_2px_--theme(--color-black/4%),0_8px_24px_--theme(--color-black/4%)] transition-[border-color,background-color,box-shadow] duration-150 focus-within:border-foreground/20 focus-within:ring-2 focus-within:ring-ring/30 dark:shadow-[0_1px_2px_--theme(--color-black/40%),0_8px_24px_--theme(--color-black/30%)] motion-reduce:transition-none",
        current?.private &&
          "border-l-4 border-dashed border-warning/70 bg-warning/10 focus-within:border-warning",
      )}
    >
      {showContextStrip ? (
        <div
          className={cn(
            "mb-1.5 flex flex-wrap items-center justify-between gap-2 border-b px-1 pb-1.5",
            current?.private ? "border-warning/30" : "border-border/60",
          )}
        >
          {showModeBar && props.modes ? (
            <div
              role="tablist"
              aria-label={t("inbox.mode", { mode: current?.label ?? "" })}
              className="inline-flex items-center gap-1 rounded-lg bg-muted/70 p-0.5"
            >
              {props.modes.map((item) => {
                const ModeIcon = item.icon;
                const active = item.value === current?.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={props.disabled}
                    onClick={() => props.onModeChange?.(item.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active && item.private
                        ? "bg-warning/25 text-warning-foreground ring-1 ring-warning/60"
                        : active
                          ? "bg-background text-foreground shadow-xs ring-1 ring-border"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {ModeIcon ? (
                      <ModeIcon aria-hidden="true" className="size-3.5" />
                    ) : null}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {current?.description ? (
            <p
              className={cn(
                "flex items-center gap-1 text-xs",
                current.private
                  ? "font-medium text-warning-foreground"
                  : "text-muted-foreground",
              )}
            >
              {current.private ? (
                <Lock aria-hidden="true" className="size-3 shrink-0" />
              ) : null}
              <span>{current.description}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {props.banner ? <div className="mb-1.5">{props.banner}</div> : null}
      <Textarea
        unstyled
        ref={props.inputRef}
        aria-label={props.label}
        placeholder={props.label}
        value={props.value}
        disabled={props.disabled}
        rows={2}
        onPaste={props.onPaste}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          )
            return;
          event.preventDefault();
          send();
        }}
        className="block text-sm [&_textarea]:max-h-60 [&_textarea]:min-h-12 [&_textarea]:resize-none [&_textarea]:px-2 [&_textarea]:py-1.5 [&_textarea]:placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        {props.tools}
        <div className="ms-auto flex items-center gap-1.5">
          {props.sendExtra}
          {current?.sendLabel ? (
            <Button
              type="button"
              size="sm"
              variant={current.private ? "outline" : "default"}
              disabled={!ready}
              onClick={send}
              className={cn(
                current.private &&
                  "border-warning/70 bg-warning/20 text-warning-foreground hover:bg-warning/30",
              )}
            >
              <SendIcon aria-hidden="true" className="size-3.5" />
              {current.sendLabel}
            </Button>
          ) : (
            <IconButton
              variant="default"
              className="rounded-full"
              label={t("inbox.send")}
              loading={props.sending}
              disabled={!ready}
              onClick={send}
            >
              <ArrowUp aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
