import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type ReactNode,
} from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { saveDraft, startingDraft } from "../../core/composer-draft";
import type { PortalProblem } from "../../core/types";
import { ArrowUpIcon } from "../arrow-up-icon";
import { PortalForm } from "../portal-form";
import { Input, cn } from "../upstream";
import { BoardSelect } from "./board-select";
import { ComposerDetails } from "./composer-details";
import { ComposerSignIn } from "./composer-sign-in";

interface PostComposerValues {
  boardId?: string;
  title: string;
  content: string;
}

export interface PostComposerProps {
  workspaceName: string;
  boards: Array<{ id: string; name: string }>;
  defaultBoardId?: string;
  /** Set for a visitor who must sign in first; the composer then only searches. */
  signInHref?: string;
  autoFocus?: boolean;
  /** Saves an unsent title and details on this device under this key. */
  draftKey?: string;
  /** A title to start from, such as a search that found nothing. */
  initialTitle?: string;
  /** A file control in the footer; it gets whether the form is sending. */
  attachments?: (submitting: boolean) => ReactNode;
  /** A helper under the details: it reads the draft and can replace it. */
  assist?: (
    draft: () => PostComposerValues,
    apply: (values: PostComposerValues) => void,
  ) => ReactNode;
  onTitleChange: (title: string) => void;
  onSubmit: (values: PostComposerValues) => Promise<PortalProblem | void>;
}

const card =
  "rounded-xl border border-border bg-card px-4 py-3 shadow-xs transition-shadow focus-within:shadow-sm";

export function PostComposer(props: PostComposerProps) {
  const { t } = useTranslation("quills");
  const [draft] = useState(() =>
    startingDraft(props.draftKey, props.initialTitle),
  );
  const [expanded, setExpanded] = useState(
    Boolean(props.autoFocus || draft.title || draft.content),
  );
  const [title, setTitle] = useState(draft.title);
  const [round, setRound] = useState(0);
  const schema = z.object({
    boardId: z.string().optional(),
    title: z.string().trim().min(1, t("feedback.titleRequired")).max(200),
    content: z.string().trim().max(10000),
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A restored or given title shows its similar posts at once.
  const { onTitleChange } = props;
  useEffect(() => {
    if (draft.title.trim()) onTitleChange(draft.title);
  }, [draft.title, onTitleChange]);
  // Similar-post search is rate limited, so it waits until typing pauses.
  const changeTitle = (value: string) => {
    setTitle(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onTitleChange(value), 300);
  };
  const remember = (values: { title?: string; content?: string }) =>
    saveDraft(props.draftKey, {
      title: values.title ?? "",
      content: values.content ?? "",
    });
  const collapse = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget) && !title.trim())
      setExpanded(false);
  };
  const titleInput = (field?: ComponentProps<typeof Input>) => (
    <Input
      unstyled
      className="text-base"
      id="feedback-title"
      aria-label={t("feedback.postTitle")}
      placeholder={t("feedback.composer", { name: props.workspaceName })}
      autoFocus={props.autoFocus}
      onFocus={() => setExpanded(true)}
      {...field}
    />
  );

  if (props.signInHref)
    return (
      <div className={card} onBlur={collapse}>
        {titleInput({
          defaultValue: draft.title,
          onChange: (event: { target: { value: string } }) =>
            changeTitle(event.target.value),
        })}
        {expanded ? <ComposerSignIn href={props.signInHref} /> : null}
      </div>
    );

  return (
    <div onBlur={collapse}>
      <PortalForm
        key={round}
        schema={schema}
        defaultValues={{
          boardId: props.defaultBoardId ?? props.boards[0]?.id,
          title: round ? "" : draft.title,
          content: round ? "" : draft.content,
        }}
        submitKey="feedback.submit"
        submitIcon={<ArrowUpIcon />}
        className={cn(
          card,
          "max-w-none gap-1 py-2",
          !expanded && "[&>div:last-child]:hidden",
        )}
        onSubmit={async (values) => {
          const problem = await props.onSubmit(values);
          if (!problem) {
            saveDraft(props.draftKey, { title: "", content: "" });
            changeTitle("");
            setExpanded(false);
            setRound(round + 1);
          }
          return problem;
        }}
        footer={(form) => (
          <>
            {props.attachments?.(form.formState.isSubmitting)}
            <Controller
              control={form.control}
              name="boardId"
              render={({ field }) => (
                <BoardSelect
                  name={field.name}
                  boards={props.boards}
                  value={field.value}
                  triggerRef={field.ref}
                  onChange={field.onChange}
                />
              )}
            />
          </>
        )}
      >
        {(form) => (
          <>
            {titleInput(
              form.register("title", {
                onChange: (event) => {
                  changeTitle(event.target.value);
                  remember(form.getValues());
                },
              }),
            )}
            {form.formState.errors.title?.message ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {String(form.formState.errors.title.message)}
              </p>
            ) : null}
            {expanded ? (
              <ComposerDetails
                {...form.register("content", {
                  onChange: () => remember(form.getValues()),
                })}
              />
            ) : null}
            {expanded &&
              props.assist?.(form.getValues, (values) => {
                form.reset(values, { keepDefaultValues: true });
                changeTitle(values.title);
                remember(values);
              })}
          </>
        )}
      </PortalForm>
      {round ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t("feedback.submitted")}
        </p>
      ) : null}
    </div>
  );
}
