import { useTranslation } from "react-i18next";
import { RequestRow } from "../../../ui/inbox/request-row";

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
    <RequestRow
      href={href}
      onOpen={onOpen}
      title={item.title}
      detail={
        item.reactions.length
          ? t("team-changelog.reads", { count: item.readCount })
          : t("team-changelog.readsNoReactions", { count: item.readCount })
      }
      badges={item.reactions.map((reaction) => ({
        id: reaction.emoji,
        label: `${reaction.emoji} ${reaction.count}`,
      }))}
      time={item.publishedAt}
    />
  );
}
