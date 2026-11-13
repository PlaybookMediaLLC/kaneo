import { z } from "zod";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem, Viewer } from "../../../core/types";
import { useFindPortalSimilarPosts } from "../../../hooks/feedback/use-find-portal-similar-posts";
import { PortalForm } from "../../../ui/portal-form";
import { StateView } from "../../../ui/state-view";
import { Input, Label, Textarea } from "../../../ui/upstream";
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
export interface SubmitPostFormProps {
  boards: Array<{ id: string; name: string }>;
  defaultBoardId?: string;
  viewer: Viewer;
  workspaceId: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
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
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ boardId: props.defaultBoardId, title: "", content: "" }}
      submitKey="feedback.submit"
      onSubmit={props.onSubmit}
    >
      {(form) => (
        <>
          <Label htmlFor="feedback-board">{t("feedback.board")}</Label>
          <select id="feedback-board" {...form.register("boardId")}>
            {props.boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
          <Label htmlFor="feedback-title">{t("feedback.postTitle")}</Label>
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
          <Label htmlFor="feedback-content">{t("feedback.content")}</Label>
          <Textarea
            id="feedback-content"
            {...form.register("content")}
            aria-invalid={Boolean(form.formState.errors.content)}
          />
          {form.formState.errors.content?.message ? (
            <p role="alert">{form.formState.errors.content.message}</p>
          ) : null}
        </>
      )}
    </PortalForm>
  );
}
