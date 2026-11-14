import { ChevronRight, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import type { ListStatusesResponse } from "../../../api/team/list-statuses";
import type { ListTagsResponse } from "../../../api/team/list-tags";
import type { PortalProblem } from "../../../core/types";
import { FormSelect } from "../../../ui/form-select";
import { PortalForm } from "../../../ui/portal-form";
import {
  Button,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuTrigger,
  Textarea,
} from "../../../ui/upstream";

// The bounds of createQuillsPost.
const schema = z.object({
  boardId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(10000),
  statusId: z.string(),
  tagIds: z.array(z.string()).max(50),
});
export type NewRequestValues = z.infer<typeof schema>;

export interface NewRequestFormProps {
  boards: ListBoardsResponse["items"];
  statuses: ListStatusesResponse["statuses"];
  tags: ListTagsResponse["tags"];
  /** The board of the list filter, or the first board. */
  boardId?: string;
  /** The author control at the start of the header row. */
  author: ReactNode;
  onSubmit: (values: NewRequestValues) => Promise<PortalProblem | void>;
}

/** The New request card: author and board, the title and details, then status, tags and Create. */
export function NewRequestForm(props: NewRequestFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm<NewRequestValues>
      schema={schema}
      defaultValues={{
        boardId: props.boardId ?? props.boards[0]?.id ?? "",
        title: "",
        content: "",
        statusId: props.statuses.find((status) => status.isDefault)?.id ?? "",
        tagIds: [],
      }}
      submitKey="team-posts.create"
      className="max-w-none gap-3 py-0"
      onSubmit={props.onSubmit}
      footer={(form) => {
        const tagIds = form.watch("tagIds");
        return (
          <div className="me-auto flex flex-wrap items-center gap-2">
            <FormSelect
              control={form.control}
              name="statusId"
              label={t("team-posts.status")}
              hideLabel
              size="sm"
              options={props.statuses.map((status) => ({
                value: status.id,
                label: status.name,
              }))}
            />
            <Menu>
              <MenuTrigger
                render={<Button type="button" variant="outline" size="sm" />}
              >
                <Tag aria-hidden="true" />
                {tagIds.length
                  ? t("team-posts.tagCount", { count: tagIds.length })
                  : t("team-posts.tags")}
              </MenuTrigger>
              <MenuPopup align="start">
                {props.tags.length ? null : (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    {t("team-posts.noTags")}
                  </p>
                )}
                {props.tags.map((tag) => (
                  <MenuCheckboxItem
                    key={tag.id}
                    checked={tagIds.includes(tag.id)}
                    onCheckedChange={(checked) =>
                      form.setValue(
                        "tagIds",
                        checked
                          ? [...tagIds, tag.id]
                          : tagIds.filter((id) => id !== tag.id),
                      )
                    }
                  >
                    {tag.name}
                  </MenuCheckboxItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        );
      }}
    >
      {(form) => (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pe-8 text-sm">
            {props.author}
            <ChevronRight
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <FormSelect
              control={form.control}
              name="boardId"
              label={t("team-posts.board")}
              hideLabel
              size="sm"
              options={props.boards.map((board) => ({
                value: board.id,
                label: board.name,
              }))}
            />
          </div>
          <Input
            unstyled
            autoFocus
            aria-label={t("team-posts.titleLabel")}
            placeholder={t("team-posts.titleLabel")}
            aria-invalid={Boolean(form.formState.errors.title)}
            className="flex w-full rounded-md text-lg font-semibold focus-within:ring-2 focus-within:ring-ring"
            {...form.register("title")}
          />
          {form.formState.errors.title?.message ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {form.formState.errors.title.message}
            </p>
          ) : null}
          <Textarea
            unstyled
            aria-label={t("team-posts.details")}
            placeholder={t("team-posts.details")}
            className="flex w-full rounded-md text-sm focus-within:ring-2 focus-within:ring-ring [&_textarea]:min-h-28"
            {...form.register("content")}
          />
        </>
      )}
    </PortalForm>
  );
}
