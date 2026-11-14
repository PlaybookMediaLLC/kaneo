import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { useCreatePostFromConversation } from "../../../hooks/team/use-create-post-from-conversation";
import { useGetConversationTicketLink } from "../../../hooks/team/use-get-conversation-ticket-link";
import { useGetLinkedPostsForConversation } from "../../../hooks/team/use-get-linked-posts-for-conversation";
import { useListBoards } from "../../../hooks/team/use-list-boards";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { PropertyRow } from "../../../ui/inbox/property-row";
import { Button } from "../../../ui/upstream";
import { ActionProblem } from "./action-problem";
import { CreatePostForm } from "./create-post-form";

export interface LinksSectionProps {
  workspaceId: string;
  conversationId: string;
}

const link = "text-primary underline-offset-4 hover:underline";

/** The customer ticket and the feedback posts of a conversation, and a form to track it as a new post. */
export function LinksSection({
  workspaceId,
  conversationId,
}: LinksSectionProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId, conversationId };
  const ticket = useGetConversationTicketLink({ param }, team.viewer);
  const posts = useGetLinkedPostsForConversation({ param }, team.viewer);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const boards = useListBoards(
    {
      param: { workspaceId: creating ? workspaceId : "" },
      query: { counts: "false", offset: "0", limit: "100" },
    },
    team.viewer,
  );
  const create = useCreatePostFromConversation(team.viewer);
  const paired = ticket.data?.ticket;
  return (
    <section aria-labelledby="conversation-links">
      <h2 id="conversation-links" className="mb-1 text-sm font-semibold">
        {t("team-conversations.links.title")}
      </h2>
      <PropertyRow label={t("team-conversations.links.ticket")}>
        {paired ? (
          <Link
            to={teamHref(workspaceId, `/tickets/${paired.id}`)}
            className={link}
          >
            {t("team-conversations.links.ticketName", {
              reference: paired.reference,
              title: paired.title,
              status: paired.status.name,
            })}
          </Link>
        ) : (
          t("team-conversations.links.none")
        )}
      </PropertyRow>
      <PropertyRow label={t("team-conversations.links.posts")}>
        {posts.data?.items.length ? (
          <ul className="grid gap-1">
            {posts.data.items.map((post) => (
              <li key={post.postId}>
                <Link
                  to={teamHref(workspaceId, `/posts/${post.postId}`)}
                  className={link}
                >
                  {post.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          t("team-conversations.links.none")
        )}
      </PropertyRow>
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
      <ActionProblem problem={boards.error ?? null} />
      {creating && boards.data ? (
        <CreatePostForm
          boards={boards.data.items}
          onCancel={() => setCreating(false)}
          onSubmit={async (json): Promise<PortalProblem | void> => {
            try {
              await create.mutateAsync({ param, json });
              setCreating(false);
              setNotice(
                t("team-conversations.links.created", { title: json.title }),
              );
            } catch (error) {
              return error as PortalProblem;
            }
          }}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          loading={creating && boards.isLoading}
          disabled={!team.permissions.create}
          onClick={() => {
            setNotice("");
            setCreating(true);
          }}
        >
          {t("team-conversations.links.create")}
        </Button>
      )}
    </section>
  );
}
