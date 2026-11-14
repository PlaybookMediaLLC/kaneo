import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAcceptFeedbackSignalAsPost } from "../../hooks/team/use-accept-feedback-signal-as-post";
import { useAcceptFeedbackSignalAsVote } from "../../hooks/team/use-accept-feedback-signal-as-vote";
import { useDismissFeedbackSignal } from "../../hooks/team/use-dismiss-feedback-signal";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListFeedbackSignals } from "../../hooks/team/use-list-feedback-signals";
import { useRestoreFeedbackSignal } from "../../hooks/team/use-restore-feedback-signal";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { PortalSheetContent } from "../../ui/portal-sheet-content";
import {
  Button,
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../../ui/upstream";
import { AcceptPostForm } from "./parts/accept-post-form";
import { SignalRow, type Signal } from "./parts/signal-row";

export interface TeamAutopilotPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const filters = {
  pending: "autopilot.pending",
  accepted: "autopilot.accepted",
  dismissed: "autopilot.dismissed",
} as const;
type Filter = keyof typeof filters;

/** The autopilot review queue: accept a signal as a post or a vote, dismiss it or restore it. */
export function TeamAutopilotPage({ workspaceId }: TeamAutopilotPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [status, setStatus] = useState<Filter>("pending");
  const [notice, setNotice] = useState("");
  const [accepting, setAccepting] = useState<Signal | null>(null);
  const list = useListFeedbackSignals(
    { param: { workspaceId }, query: { status, limit: "50" } },
    team.viewer,
  );
  // ponytail: the first 100 boards (the API maximum), as on the overview page.
  const boards = useListBoards(
    {
      param: { workspaceId },
      query: { counts: "false", offset: "0", limit: "100" },
    },
    team.viewer,
  );
  const acceptPost = useAcceptFeedbackSignalAsPost(team.viewer);
  const acceptVote = useAcceptFeedbackSignalAsVote(team.viewer);
  const dismiss = useDismissFeedbackSignal(team.viewer);
  const restore = useRestoreFeedbackSignal(team.viewer);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PageFrame
      titleKey="autopilot.title"
      description={t("autopilot.description")}
      landmark={false}
      wide
      actions={
        <div
          role="group"
          aria-label={t("autopilot.filter")}
          className="flex gap-2"
        >
          {(Object.keys(filters) as Filter[]).map((value) => (
            <Button
              key={value}
              type="button"
              variant={status === value ? "secondary" : "outline"}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {t(filters[value])}
            </Button>
          ))}
        </div>
      }
    >
      <p role="status" className="mb-3 text-sm text-muted-foreground">
        {notice}
      </p>
      <TeamStateView
        loading={list.isLoading}
        problem={list.error ?? null}
        empty={!items.length}
        onRetry={() => void list.refetch()}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((signal) => {
            const param = { workspaceId, signalId: signal.id };
            const title = { title: signal.suggestedTitle };
            return (
              <SignalRow
                key={signal.id}
                signal={signal}
                canAccept={team.permissions.create}
                canReview={team.permissions.update}
                onAcceptAsPost={() => setAccepting(signal)}
                onVote={async () => {
                  const post = signal.matchedPost!;
                  await acceptVote.mutateAsync({
                    param,
                    json: { postId: post.id },
                  });
                  setNotice(t("autopilot.voted", { post: post.title }));
                }}
                onDismiss={async () => {
                  await dismiss.mutateAsync({ param });
                  setNotice(t("autopilot.dismissedSignal", title));
                }}
                onRestore={async () => {
                  await restore.mutateAsync({ param });
                  setNotice(t("autopilot.restored", title));
                }}
              />
            );
          })}
        </ul>
        {list.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t("autopilot.loadMore")}
          </Button>
        ) : null}
      </TeamStateView>
      <Sheet
        open={Boolean(accepting)}
        onOpenChange={(open) => !open && setAccepting(null)}
      >
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("autopilot.sheetTitle")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            {accepting ? (
              <AcceptPostForm
                key={accepting.id}
                boards={boards.data?.items ?? []}
                title={accepting.suggestedTitle}
                onSubmit={async (values) => {
                  await acceptPost.mutateAsync({
                    param: { workspaceId, signalId: accepting.id },
                    json: values,
                  });
                  setAccepting(null);
                  setNotice(t("autopilot.created", { title: values.title }));
                }}
              />
            ) : null}
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
    </PageFrame>
  );
}
