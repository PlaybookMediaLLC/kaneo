import { useTranslation } from "react-i18next";
import { ListRow } from "../../../ui/inbox/list-row";

export interface EngagementRowProps {
  item: {
    id: string;
    title: string;
    publishedAt: string;
    readCount: number;
    reactions: Array<{ emoji: string; count: number }>;
  };
  /** The published update on the portal. */
  href: string;
  onOpen: () => void;
}

/** One published update with its readers and reactions. */
export function EngagementRow({ item, href, onOpen }: EngagementRowProps) {
  const { t } = useTranslation("quills");
  return (
    <ListRow
      href={href}
      onOpen={onOpen}
      title={item.title}
      preview={
        item.reactions.length
          ? t("team-changelog.reads", { count: item.readCount })
          : t("team-changelog.readsNoReactions", { count: item.readCount })
      }
      chips={item.reactions.map((reaction) => ({
        id: reaction.emoji,
        label: `${reaction.emoji} ${reaction.count}`,
      }))}
      time={item.publishedAt}
    />
  );
}
