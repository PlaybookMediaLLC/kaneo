import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { ConfirmAction } from "../../../ui/confirm-action";
import { MarkdownContent } from "../../../ui/markdown-content";
import { StateView } from "../../../ui/state-view";
import {
  Button,
  Checkbox,
  Label,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../../../ui/upstream";

/** The API takes at most this many posts for one draft. */
const MAX_POSTS = 25;

export interface DraftSheetProps {
  posts: Array<{ id: string; title: string; voteCount: number }>;
  draft: { title: string; body: string; requesterCount: number } | null;
  problem: PortalProblem | null;
  onDraft: (postIds: string[]) => Promise<void>;
}

/** Picks shipped requests and shows the AI draft for review. Nothing is saved. */
export function DraftSheet({
  posts,
  draft,
  problem,
  onDraft,
}: DraftSheetProps) {
  const { t } = useTranslation("quills");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const toggle = (id: string, checked: boolean) =>
    setChosen((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id),
    );
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("team-changelog.draft.open")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("team-changelog.draft.open")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                {t("team-changelog.draft.choose")}
              </legend>
              {posts.length ? null : (
                <p className="text-sm text-muted-foreground">
                  {t("team-changelog.draft.none")}
                </p>
              )}
              {posts.map((post) => (
                <div key={post.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`draft-${post.id}`}
                    checked={chosen.includes(post.id)}
                    disabled={
                      !chosen.includes(post.id) && chosen.length >= MAX_POSTS
                    }
                    onCheckedChange={(checked) => toggle(post.id, checked)}
                  />
                  <Label htmlFor={`draft-${post.id}`}>
                    {t("team-changelog.draft.post", {
                      title: post.title,
                      count: post.voteCount,
                    })}
                  </Label>
                </div>
              ))}
            </fieldset>
            <ConfirmAction
              labelKey="team-changelog.draft.submit"
              disabled={!chosen.length}
              onConfirm={() => onDraft(chosen)}
            />
            <StateView problem={problem}>{null}</StateView>
            {draft ? (
              <section aria-labelledby="team-changelog-draft" className="mt-6">
                <h3 id="team-changelog-draft" className="text-sm font-medium">
                  {t("team-changelog.draft.result")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("team-changelog.draft.review")}{" "}
                  {t("team-changelog.draft.requesters", {
                    count: draft.requesterCount,
                  })}
                </p>
                <p className="mt-3 text-lg font-semibold">{draft.title}</p>
                <MarkdownContent content={draft.body} />
              </section>
            ) : null}
          </SheetPanel>
        </SheetContent>
      </Sheet>
    </>
  );
}
