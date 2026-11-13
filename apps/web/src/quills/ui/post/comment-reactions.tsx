import {
  IconFacePlusOutline18,
  IconHeartOutline18,
} from "nucleo-ui-essential-outline-18";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmAction } from "../confirm-action";

export interface CommentReactionsProps {
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  /** Toggles a reaction; the reactions are read-only without it. */
  onReact?: (emoji: string, reacted: boolean) => Promise<void>;
}

// The reactions that the API accepts. The heart is the like.
const EMOJI = ["👍", "❤️", "🎉", "😄", "😕", "👀", "🚀"];
const LIKE = "❤️";
// Resets the upstream button so a reaction looks like the other comment actions.
const reset =
  "h-auto border-0 bg-transparent px-0 font-normal shadow-none before:hidden hover:bg-transparent aria-pressed:bg-transparent sm:h-auto sm:text-xs dark:bg-transparent";
const like = `${reset} gap-1 text-xs text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:[&_path]:fill-current [&_svg]:size-3.5`;
const chip = `${reset} h-6 gap-1 rounded-full border border-border px-2 text-xs tabular-nums hover:bg-muted aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary sm:h-6`;

/** The like, the other reactions as toggles, and a picker for a new reaction. */
export function CommentReactions({
  reactions,
  onReact,
}: CommentReactionsProps) {
  const { t } = useTranslation("quills");
  const [picking, setPicking] = useState(false);
  const find = (emoji: string) =>
    reactions.find((reaction) => reaction.emoji === emoji);
  const toggle = (emoji: string) => onReact!(emoji, !find(emoji)?.reacted);
  const liked = find(LIKE);
  return (
    <>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <ConfirmAction
          labelKey="post.like"
          pressed={Boolean(liked?.reacted)}
          disabled={!onReact}
          className={like}
          onConfirm={() => toggle(LIKE)}
        >
          <IconHeartOutline18 aria-hidden="true" />
        </ConfirmAction>
        {liked?.count ? <span>{liked.count}</span> : null}
      </span>
      {reactions
        .filter((reaction) => reaction.emoji !== LIKE && reaction.count > 0)
        .map((reaction) => (
          <ConfirmAction
            key={reaction.emoji}
            labelKey="post.react"
            label={t("post.reaction", {
              emoji: reaction.emoji,
              count: reaction.count,
            })}
            pressed={reaction.reacted}
            disabled={!onReact}
            className={chip}
            onConfirm={() => toggle(reaction.emoji)}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span aria-hidden="true">{reaction.count}</span>
          </ConfirmAction>
        ))}
      {onReact ? (
        <span className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-expanded={picking}
            aria-label={t("post.addReaction")}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
            onClick={() => setPicking(!picking)}
          >
            <IconFacePlusOutline18 aria-hidden="true" />
          </button>
          {picking
            ? EMOJI.filter((emoji) => emoji !== LIKE).map((emoji) => (
                <ConfirmAction
                  key={emoji}
                  labelKey="post.react"
                  label={t("post.reactWith", { emoji })}
                  pressed={Boolean(find(emoji)?.reacted)}
                  className={`${reset} size-7 justify-center rounded-full text-sm hover:bg-muted aria-pressed:bg-muted sm:size-7`}
                  onConfirm={async () => {
                    await toggle(emoji);
                    setPicking(false);
                  }}
                >
                  <span aria-hidden="true">{emoji}</span>
                </ConfirmAction>
              ))
            : null}
        </span>
      ) : null}
    </>
  );
}
