import { ArrowUp, ChevronDown } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  cn,
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../upstream";
import { IconButton } from "./icon-button";
import type { ComposerMode } from "./inbox-types";

export interface ComposerProps {
  /** The accessible name and the placeholder, such as "Reply to Ada…". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Runs on Enter and on the send button when the text is not empty. */
  onSend: () => void;
  /** The choices of the mode dropdown, such as Reply and Note, or Public and Private. */
  modes?: readonly ComposerMode[];
  mode?: string;
  onModeChange?: (mode: string) => void;
  /** Buttons at the start of the toolbar, such as attach and emoji. */
  tools?: ReactNode;
  sending?: boolean;
  disabled?: boolean;
  /** The text box, so that R and N can focus it. */
  inputRef?: Ref<HTMLTextAreaElement>;
}

/** The rounded message box at the bottom of a thread. Enter sends; Shift+Enter adds a line. */
export function Composer(props: ComposerProps) {
  const { t } = useTranslation("quills");
  const current =
    props.modes?.find((mode) => mode.value === props.mode) ?? props.modes?.[0];
  const ready =
    Boolean(props.value.trim()) && !props.sending && !props.disabled;
  const send = () => {
    if (ready) props.onSend();
  };
  const Icon = current?.icon;
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-background p-2 shadow-xs focus-within:ring-2 focus-within:ring-ring",
        current?.private && "border-warning/40 bg-warning/5",
      )}
    >
      <textarea
        ref={props.inputRef}
        aria-label={props.label}
        placeholder={props.label}
        value={props.value}
        disabled={props.disabled}
        rows={2}
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
        className="block max-h-60 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        {props.tools}
        {current && props.modes && props.modes.length > 1 ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("inbox.mode", { mode: current.label })}
                />
              }
            >
              {Icon ? <Icon aria-hidden="true" /> : null}
              {current.label}
              <ChevronDown aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup
                value={current.value}
                onValueChange={(value) => props.onModeChange?.(String(value))}
              >
                {props.modes.map((mode) => (
                  <MenuRadioItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        ) : null}
        <IconButton
          variant="default"
          className="ms-auto rounded-full"
          label={t("inbox.send")}
          loading={props.sending}
          disabled={!ready}
          onClick={send}
        >
          <ArrowUp aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
