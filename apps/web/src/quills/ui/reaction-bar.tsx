import { useTranslation } from "react-i18next";
import { ConfirmAction } from "./confirm-action";

/** The emoji that the API accepts for a changelog reaction, in display order. */
const EMOJI = ["👍", "❤️", "🎉", "😄", "😕", "👀", "🚀"];
// Resets the upstream button so a reaction reads as a small chip.
const chip =
  "h-7 gap-1 rounded-full border border-border bg-transparent px-2 text-xs font-normal tabular-nums shadow-none before:hidden hover:bg-muted aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary sm:h-7";

export interface ReactionBarProps {
  reactions: ReadonlyArray<{ emoji: string; count: number; reacted: boolean }>;
  /** Toggles a reaction. Without it the bar is read-only and shows only used emoji. */
  onReact?: (emoji: string, reacted: boolean) => Promise<void>;
}

/** Emoji reactions under a changelog update. */
export function ReactionBar({ reactions, onReact }: ReactionBarProps) {
  const { t } = useTranslation("quills");
  const shown = EMOJI.map((emoji) => ({
    emoji,
    count: 0,
    reacted: false,
    ...reactions.find((reaction) => reaction.emoji === emoji),
  })).filter((reaction) => onReact || reaction.count > 0);
  if (!shown.length) return null;
  return (
    <div
      role="group"
      aria-label={t("engagement.reactions")}
      className="mt-6 flex flex-wrap gap-1.5"
    >
      {shown.map((reaction) => (
        <ConfirmAction
          key={reaction.emoji}
          labelKey="engagement.react"
          labelValues={{ emoji: reaction.emoji, count: reaction.count }}
          pressed={reaction.reacted}
          disabled={!onReact}
          className={chip}
          onConfirm={() => onReact!(reaction.emoji, !reaction.reacted)}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          {reaction.count ? (
            <span aria-hidden="true">{reaction.count}</span>
          ) : null}
        </ConfirmAction>
      ))}
    </div>
  );
}
