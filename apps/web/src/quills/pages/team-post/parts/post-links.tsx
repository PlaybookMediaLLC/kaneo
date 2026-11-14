import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetLinkedConversationsForPost } from "../../../hooks/team/use-get-linked-conversations-for-post";
import { useListLinks } from "../../../hooks/team/use-list-links";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { PropertyRow } from "../../../ui/inbox/property-row";
import { LinkedTask } from "./linked-task";

export interface PostLinksProps {
  workspaceId: string;
  postId: string;
}

/** The Kaneo tasks and the support conversations that a post links to. */
export function PostLinks({ workspaceId, postId }: PostLinksProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  // ponytail: the first 100 post-task links of the workspace (the API maximum); add a
  // post filter to listQuillsLinks when a workspace links more tasks.
  const links = useListLinks(
    { param: { workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const conversations = useGetLinkedConversationsForPost(
    { param: { workspaceId, postId } },
    team.viewer,
  );
  const tasks =
    links.data?.posts.filter((link) => link.postId === postId) ?? [];
  const failed = links.error ?? conversations.error;
  return (
    <section aria-label={t("team-post.links")} className="py-2">
      {failed ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {t("core.problem.failed")}
        </p>
      ) : null}
      <PropertyRow label={t("team-post.tasks")}>
        {tasks.length ? (
          <ul className="grid grid-cols-1 gap-1">
            {tasks.map((link) => (
              <li key={link.taskId}>
                <LinkedTask workspaceId={workspaceId} taskId={link.taskId} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">{t("team-post.none")}</span>
        )}
      </PropertyRow>
      <PropertyRow label={t("team-post.conversations")}>
        {conversations.data?.items.length ? (
          <ul className="grid grid-cols-1 gap-1">
            {conversations.data.items.map((item) => (
              <li key={item.conversationId}>
                <Link
                  to={teamHref(
                    workspaceId,
                    `/conversations/${encodeURIComponent(item.conversationId)}`,
                  )}
                  className="flex min-w-0 items-center gap-1.5 hover:underline"
                >
                  <MessagesSquare
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                  <span className="truncate">
                    {item.subject ?? t("team-post.noSubject")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">{t("team-post.none")}</span>
        )}
      </PropertyRow>
    </section>
  );
}
