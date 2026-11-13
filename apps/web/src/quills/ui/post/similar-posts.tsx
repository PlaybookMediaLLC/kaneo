import { useId } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { ArrowUpIcon } from "../arrow-up-icon";
import { StatusIcon } from "./status-icon";

export interface SimilarPostsProps {
  workspaceId: string;
  /** The list heading; similar posts by default. */
  titleKey?: string;
  posts: Array<{
    id: string;
    title: string;
    voteCount: number;
    stage: string | null;
  }>;
}

/** A compact list of posts, such as matches for a new title or an update's requests. */
export function SimilarPosts({
  workspaceId,
  titleKey = "feedback.similar",
  posts,
}: SimilarPostsProps) {
  const { t } = useTranslation("quills");
  const headingId = useId();
  if (!posts.length) return null;
  return (
    <section aria-labelledby={headingId} className="portal-similar-posts">
      <h2
        id={headingId}
        className="mb-1 text-xs font-normal text-muted-foreground"
      >
        {t(titleKey)}
      </h2>
      <ul className="-mx-3">
        {posts.map((post) => (
          <li key={post.id}>
            <a
              className="flex items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
              href={portalHref(workspaceId, `posts/${post.id}`)}
            >
              <span className="inline-flex h-7 min-w-13 items-center justify-center gap-1.5 rounded-full border border-border px-2.5 text-xs tabular-nums">
                <ArrowUpIcon className="size-[11px]" />
                <span className="sr-only">
                  {t("post.votes", { count: post.voteCount })}
                </span>
                <span aria-hidden="true">{post.voteCount}</span>
              </span>
              <span className="min-w-0 flex-1 truncate font-medium tracking-tight">
                {post.title}
              </span>
              {post.stage && post.stage !== "open" ? (
                <StatusIcon stage={post.stage} className="size-3.5" />
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
