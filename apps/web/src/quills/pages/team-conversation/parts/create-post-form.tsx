import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from "../../../ui/upstream";
import { PropertySelect } from "./property-select";

const schema = z.object({
  boardId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().max(10000),
});
export type CreatePostValues = z.infer<typeof schema>;

export interface CreatePostFormProps {
  boards: readonly { id: string; name: string }[];
  onSubmit: (values: CreatePostValues) => Promise<PortalProblem | void>;
  onCancel: () => void;
}

/** Tracks the conversation as a feedback post by its customer on a board. */
export function CreatePostForm({
  boards,
  onSubmit,
  onCancel,
}: CreatePostFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ boardId: boards[0]?.id ?? "", title: "", content: "" }}
      submitKey="team-conversations.links.create"
      onSubmit={onSubmit}
      className="max-w-none gap-3"
      footer={() => (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("team-conversations.cancel")}
        </Button>
      )}
    >
      {(form) => (
        <>
          <PropertySelect
            label={t("team-conversations.links.board")}
            value={form.watch("boardId")}
            options={boards.map((board) => ({
              value: board.id,
              label: board.name,
            }))}
            onChange={(value) => form.setValue("boardId", value)}
          />
          <Field invalid={Boolean(form.formState.errors.title)}>
            <FieldLabel htmlFor="conversation-post-title">
              {t("team-conversations.links.postTitle")}
            </FieldLabel>
            <Input
              id="conversation-post-title"
              maxLength={200}
              aria-invalid={Boolean(form.formState.errors.title)}
              {...form.register("title")}
            />
            {form.formState.errors.title?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {String(form.formState.errors.title.message)}
              </p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="conversation-post-content">
              {t("team-conversations.links.postContent")}
            </FieldLabel>
            <Textarea
              id="conversation-post-content"
              rows={3}
              {...form.register("content")}
            />
          </Field>
        </>
      )}
    </PortalForm>
  );
}
