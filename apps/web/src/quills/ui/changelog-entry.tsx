import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { MarkdownContent } from "./markdown-content";
import { PersonAvatar } from "./person-avatar";
import { SimilarPosts } from "./post/similar-posts";

export interface ChangelogEntryProps {
  workspaceId: string;
  entry: {
    id: string;
    title: string;
    content: string;
    publishedAt: string;
    author: { name: string; avatarUrl: string | null } | null;
    categories: Array<{ id: string; name: string }>;
    linkedPosts: Array<{
      id: string;
      title: string;
      voteCount: number;
      stage: string | null;
    }>;
    requesterCount: number;
  };
  /** The list links each title; an entry page already shows it as the page title. */
  linkTitle?: boolean;
}

/** One update on the changelog timeline: date and tags, then the release notes. */
export function ChangelogEntry({
  workspaceId,
  entry,
  linkTitle = true,
}: ChangelogEntryProps) {
  const { t, i18n } = useTranslation("quills");
  return (
    <article className="portal-update grid gap-4 pb-14 md:grid-cols-[180px_minmax(0,1fr)] md:gap-14">
      <div className="relative md:border-l md:border-dashed md:border-border md:pl-4">
        <span
          aria-hidden="true"
          className="absolute -left-[3.5px] top-2 hidden size-1.5 rounded-full bg-foreground md:block"
        />
        <p className="text-sm font-medium">
          <time
            className="!text-[13px] !text-foreground"
            dateTime={entry.publishedAt}
          >
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
            }).format(new Date(entry.publishedAt))}
          </time>
        </p>
        {entry.categories.length ? (
          <ul
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label={t("changelog.categories")}
          >
            {entry.categories.map((category) => (
              <li
                key={category.id}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {category.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="min-w-0">
        {linkTitle ? (
          <h2 className="mb-3 text-xl font-semibold tracking-tight">
            <a
              className="underline-offset-4 hover:underline"
              href={portalHref(workspaceId, `changelog/${entry.id}`)}
            >
              {entry.title}
            </a>
          </h2>
        ) : null}
        <MarkdownContent content={entry.content} />
        {entry.linkedPosts.length ? (
          <div className="mt-8">
            <SimilarPosts
              workspaceId={workspaceId}
              titleKey="changelog.linkedPosts"
              posts={entry.linkedPosts}
            />
            {entry.requesterCount ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("changelog.requesters", { count: entry.requesterCount })}
              </p>
            ) : null}
          </div>
        ) : null}
        {entry.author ? (
          <p className="mt-8 flex items-center gap-2 text-sm font-medium">
            <PersonAvatar
              name={entry.author.name}
              avatarUrl={entry.author.avatarUrl}
              className="size-6"
            />
            {entry.author.name}
          </p>
        ) : null}
      </div>
    </article>
  );
}
