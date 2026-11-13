import { IconCircleHashtagOutline18 } from "nucleo-ui-essential-outline-18";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
} from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../core/types";
import { ArrowUpIcon } from "../arrow-up-icon";
import { PortalForm } from "../portal-form";
import { PortalSelectContent } from "../portal-select-content";
import {
  Input,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "../upstream";

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
  onTitleChange: (title: string) => void;
  onSubmit: (values: PostComposerValues) => Promise<PortalProblem | void>;
}

const card =
  "rounded-xl border border-border bg-card px-4 py-3 shadow-xs transition-shadow focus-within:shadow-sm";

export function PostComposer(props: PostComposerProps) {
  const { t } = useTranslation("quills");
  const [expanded, setExpanded] = useState(Boolean(props.autoFocus));
  const [title, setTitle] = useState("");
  const [round, setRound] = useState(0);
  const schema = z.object({
    boardId: z.string().optional(),
    title: z.string().trim().min(1, t("feedback.titleRequired")).max(200),
    content: z.string().trim().max(10000),
  });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Similar-post search is rate limited, so it waits until typing pauses.
  const changeTitle = (value: string) => {
    setTitle(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onTitleChange(value), 300);
  };
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
  const items = props.boards.map((board) => ({
    value: board.id,
    label: board.name,
  }));

  if (props.signInHref)
    return (
      <div className={card} onBlur={collapse}>
        {titleInput({
          onChange: (event: { target: { value: string } }) =>
            changeTitle(event.target.value),
        })}
        {expanded ? (
          <p className="mt-2 border-t border-border pt-3 text-sm text-muted-foreground">
            {t("feedback.signInToSubmit")}{" "}
            <a
              className="font-medium text-foreground underline-offset-4 hover:underline"
              href={props.signInHref}
            >
              {t("feedback.signIn")}
            </a>
          </p>
        ) : null}
      </div>
    );

  return (
    <div onBlur={collapse}>
      <PortalForm
        key={round}
        schema={schema}
        defaultValues={{
          boardId: props.defaultBoardId ?? props.boards[0]?.id,
          title: "",
          content: "",
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
            changeTitle("");
            setExpanded(false);
            setRound(round + 1);
          }
          return problem;
        }}
        footer={(form) => (
          <Controller
            control={form.control}
            name="boardId"
            render={({ field }) => (
              <Select
                name={field.name}
                items={items}
                value={field.value ?? null}
                onValueChange={field.onChange}
              >
                <SelectTrigger
                  ref={field.ref}
                  aria-label={t("feedback.board")}
                  className="min-h-7 w-auto min-w-0 gap-1 rounded-md border-0 bg-muted/60 px-2 text-xs shadow-none before:hidden sm:min-h-7 sm:text-xs dark:bg-muted/60 [&_svg]:size-3"
                >
                  <IconCircleHashtagOutline18 aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <PortalSelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </PortalSelectContent>
              </Select>
            )}
          />
        )}
      >
        {(form) => (
          <>
            {titleInput(
              form.register("title", {
                onChange: (event) => changeTitle(event.target.value),
              }),
            )}
            {form.formState.errors.title?.message ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {String(form.formState.errors.title.message)}
              </p>
            ) : null}
            {expanded ? (
              <Textarea
                unstyled
                className="text-sm text-muted-foreground"
                aria-label={t("feedback.content")}
                placeholder={t("feedback.details")}
                {...form.register("content")}
              />
            ) : null}
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
