import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAddConversationTag } from "../../../hooks/team/use-add-conversation-tag";
import { useListConversationTags } from "../../../hooks/team/use-list-conversation-tags";
import { useRemoveConversationTag } from "../../../hooks/team/use-remove-conversation-tag";
import { useTeamRuntime } from "../../../team/runtime";
import { IconButton } from "../../../ui/inbox/icon-button";
import { ActionProblem } from "./action-problem";
import { PropertySelect } from "./property-select";

export interface TagEditorProps {
  workspaceId: string;
  conversationId: string;
  tags: readonly { id: string; name: string }[];
}

const ADD = "";

/** The tags of a conversation: remove one with its button, or add a workspace tag. */
export function TagEditor({
  workspaceId,
  conversationId,
  tags,
}: TagEditorProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const all = useListConversationTags(
    { param: { workspaceId }, query: {} },
    team.viewer,
  );
  const add = useAddConversationTag(team.viewer);
  const remove = useRemoveConversationTag(team.viewer);
  const param = { workspaceId, conversationId };
  const locked = !team.permissions.update || add.isPending || remove.isPending;
  const free = (all.data?.items ?? []).filter(
    (tag) => !tags.some((own) => own.id === tag.id),
  );
  return (
    <div className="grid gap-1.5">
      <ul className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <li
            key={tag.id}
            className="flex items-center gap-0.5 rounded-md border border-border ps-1.5 text-xs"
          >
            {tag.name}
            <IconButton
              size="icon-xs"
              label={t("team-conversations.removeTag", { name: tag.name })}
              disabled={locked}
              onClick={() =>
                remove.mutate({ param: { ...param, tagId: tag.id } })
              }
            >
              <X aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      {free.length ? (
        <PropertySelect
          label={t("team-conversations.addTag")}
          value={ADD}
          disabled={locked}
          options={[
            { value: ADD, label: t("team-conversations.addTag") },
            ...free.map((tag) => ({ value: tag.id, label: tag.name })),
          ]}
          onChange={(tagId) => add.mutate({ param, json: { tagId } })}
        />
      ) : null}
      <ActionProblem problem={add.error ?? remove.error ?? null} />
    </div>
  );
}
