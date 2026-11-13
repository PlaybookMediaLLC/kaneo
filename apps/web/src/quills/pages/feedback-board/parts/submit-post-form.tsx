import { PortalSelectContent } from "../../../ui/portal-select-content";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem, Viewer } from "../../../core/types";
import { useFindPortalSimilarPosts } from "../../../hooks/feedback/use-find-portal-similar-posts";
import { PortalForm } from "../../../ui/portal-form";
import { StateView } from "../../../ui/state-view";
import {
  Input,
  Field,
  FieldLabel,
  Textarea,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/upstream";
const schema = z
  .object({
    boardId: z.string().optional(),
    title: z
      .string()
      .trim()
      .max(200)
      .transform((value) => value || undefined)
      .optional(),
    content: z.string().trim().max(10000),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .refine((values) => Boolean(values.title || values.content), {
    path: ["content"],
  });
export type SubmitPostValues = z.infer<typeof schema>;
export interface SubmitPostFormProps {
  boards: Array<{ id: string; name: string }>;
  defaultBoardId?: string;
  viewer: Viewer;
  workspaceId: string;
  onSubmit: (values: SubmitPostValues) => Promise<PortalProblem | void>;
}
export function SubmitPostForm(props: SubmitPostFormProps) {
  const { t } = useTranslation("quills");
  const [title, setTitle] = useState("");
  const similar = useFindPortalSimilarPosts(
    {
      param: { workspace: title.trim().length >= 3 ? props.workspaceId : "" },
      query: { title: title.trim(), limit: "5" },
    },
    props.viewer,
  );
  const items = props.boards.map((board) => ({
    value: board.id,
    label: board.name,
  }));
  return (
    <PortalForm
      schema={schema}
      defaultValues={{
        boardId: props.defaultBoardId ?? props.boards[0]?.id,
        title: "",
        content: "",
      }}
      submitKey="feedback.submit"
      onSubmit={props.onSubmit}
    >
      {(form) => (
        <>
          <Controller
            control={form.control}
            name="boardId"
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.invalid}>
                <FieldLabel htmlFor="feedback-board">
                  {t("feedback.board")}
                </FieldLabel>
                <Select
                  name={field.name}
                  items={items}
                  value={field.value ?? null}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    id="feedback-board"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <PortalSelectContent>
                    <SelectGroup>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </PortalSelectContent>
                </Select>
              </Field>
            )}
          />
          <Field invalid={Boolean(form.formState.errors.title)}>
            <FieldLabel htmlFor="feedback-title">
              {t("feedback.postTitle")}
            </FieldLabel>
            <Input
              id="feedback-title"
              {...form.register("title", {
                onChange: (event) => setTitle(event.target.value),
              })}
              aria-invalid={Boolean(form.formState.errors.title)}
            />
            {form.formState.errors.title?.message ? (
              <p role="alert">{form.formState.errors.title.message}</p>
            ) : null}
          </Field>
          <StateView
            loading={similar.isLoading}
            problem={similar.error}
            onRetry={() => void similar.refetch()}
          >
            {similar.data?.items.length ? (
              <section aria-labelledby="similar-posts">
                <h3 id="similar-posts">{t("feedback.similar")}</h3>
                <ul>
                  {similar.data.items.map((post) => (
                    <li key={post.id}>{post.title}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </StateView>
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor="feedback-content">
              {t("feedback.content")}
            </FieldLabel>
            <Textarea
              id="feedback-content"
              {...form.register("content")}
              aria-invalid={Boolean(form.formState.errors.content)}
            />
            {form.formState.errors.content?.message ? (
              <p role="alert">{form.formState.errors.content.message}</p>
            ) : null}
          </Field>
        </>
      )}
    </PortalForm>
  );
}
