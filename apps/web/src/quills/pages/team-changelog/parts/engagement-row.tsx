import { useTranslation } from "react-i18next";

export interface EngagementRowProps {
  item: {
    title: string;
    publishedAt: string;
    readCount: number;
    reactions: Array<{ emoji: string; count: number }>;
  };
}

/** One published update with its readers and reactions. */
export function EngagementRow({ item }: EngagementRowProps) {
  const { t, i18n } = useTranslation("quills");
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="font-medium">{item.title}</span>
      <span className="text-sm text-muted-foreground">
        {t("team-changelog.reads", { count: item.readCount })}
      </span>
      <span className="w-full text-xs text-muted-foreground">
        {t("team-changelog.published", {
          date: new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
          }).format(new Date(item.publishedAt)),
          reactions: item.reactions.length
            ? item.reactions
                .map((reaction) => `${reaction.emoji} ${reaction.count}`)
                .join(", ")
            : t("team-changelog.noReactions"),
        })}
      </span>
    </li>
  );
}
