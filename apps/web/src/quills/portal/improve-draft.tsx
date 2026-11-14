import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblemKind, Viewer } from "../core/types";
import { useImprovePortalPostDraft } from "../hooks/feedback/use-improve-portal-post-draft";
import type { PostComposerProps } from "../ui/post/post-composer";
import { Button } from "../ui/upstream";

type PostComposerValues = Parameters<PostComposerProps["onSubmit"]>[0];

export interface ImproveDraftProps {
  workspaceId: string;
  viewer: Viewer;
  /** The composer's boards: a suggested board outside them is not used. */
  boards: Array<{ id: string }>;
  /** Reads the draft when the writer asks for help. */
  draft: () => PostComposerValues;
  /** Replaces the draft with the suggestion that the writer accepted. */
  onApply: (values: PostComposerValues) => void;
}

const problemKeys: Partial<Record<PortalProblemKind, string>> = {
  conflict: "assist.aiUnavailable",
  invalid: "assist.aiEmpty",
  rateLimited: "assist.aiRateLimited",
};

/** The route's request for a draft, within the route's bounds. */
const request = (values: PostComposerValues) => ({
  title: values.title.trim().slice(0, 200),
  details: values.content.trim().slice(0, 4000),
  boardId: values.boardId,
});

/** "Improve with AI": a suggested title, problem statement and board that the writer can use. */
export function ImproveDraft(props: ImproveDraftProps) {
  const { t } = useTranslation("quills");
  const [asked, setAsked] = useState<ReturnType<typeof request> | null>(null);
  const suggestion = useImprovePortalPostDraft(
    {
      param: { workspace: asked ? props.workspaceId : "" },
      json: asked ?? { title: "", details: "" },
    },
    props.viewer,
  );
  const data = asked ? suggestion.data : undefined;
  return (
    <div className="mt-2 grid gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        loading={Boolean(asked) && suggestion.isFetching}
        onClick={() => {
          const next = request(props.draft());
          // The same draft is the same query: ask again only after a failure.
          if (
            suggestion.isError &&
            JSON.stringify(next) === JSON.stringify(asked)
          )
            void suggestion.refetch();
          else setAsked(next);
        }}
      >
        {t("assist.improve")}
      </Button>
      {asked && suggestion.error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {t(problemKeys[suggestion.error.kind] ?? "assist.aiFailed")}
        </p>
      ) : null}
      {asked && data ? (
        <section
          aria-label={t("assist.suggestion")}
          className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm"
        >
          <p className="font-medium">{data.title}</p>
          <p className="whitespace-pre-line text-muted-foreground">
            {data.problem}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("assist.suggestionNote")}
          </p>
          <div className="mt-1 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                props.onApply({
                  boardId: props.boards.some((b) => b.id === data.boardId)
                    ? data.boardId!
                    : asked.boardId,
                  title: data.title,
                  content: data.problem,
                });
                setAsked(null);
              }}
            >
              {t("assist.apply")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAsked(null)}
            >
              {t("assist.dismiss")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
