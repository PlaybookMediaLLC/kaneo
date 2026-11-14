import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { useAcceptFeedbackSignalAsPost } from "../../hooks/team/use-accept-feedback-signal-as-post";
import { useAcceptFeedbackSignalAsVote } from "../../hooks/team/use-accept-feedback-signal-as-vote";
import { useDismissFeedbackSignal } from "../../hooks/team/use-dismiss-feedback-signal";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListFeedbackSignals } from "../../hooks/team/use-list-feedback-signals";
import { useRestoreFeedbackSignal } from "../../hooks/team/use-restore-feedback-signal";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { AcceptPostSheet } from "./parts/accept-post-sheet";
import type { Signal } from "./parts/signal-detail";
import { SignalGroups } from "./parts/signal-groups";
import { SignalList } from "./parts/signal-list";
import { SignalView } from "./parts/signal-view";

export interface TeamAutopilotPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** The autopilot review queue: the signals by status, and the open signal with its decisions. */
export function TeamAutopilotPage({ workspaceId }: TeamAutopilotPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [status, setStatus] = useState<Signal["status"]>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<PortalProblem | null>(null);
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
  // A signal that matches a post needs only a vote, so those come first.
  const groups = [
    {
      id: "match",
      label: t("autopilot.groupMatch"),
      items: items.filter((signal) => signal.matchedPost),
    },
    {
      id: "new",
      label: t("autopilot.groupNew"),
      items: items.filter((signal) => !signal.matchedPost),
    },
  ];
  const ordered = groups.flatMap((group) => group.items);
  const ids = ordered.map((signal) => signal.id);
  const open = items.find((signal) => signal.id === openId);
  useListNavigation({
    ids,
    activeId: cursor,
    onMove: setCursor,
    onOpen: setOpenId,
    enabled: !open,
  });
  /** The signal to open after a decision: the decided one leaves this list. */
  const after = (id: string) =>
    ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1] ?? null;
  const decide = (id: string, run: () => Promise<unknown>, done: string) => {
    setProblem(null);
    run().then(
      () => {
        setMessage(done);
        setOpenId(after(id));
      },
      (error: PortalProblem) => setProblem(error),
    );
  };
  const param = { workspaceId, signalId: open?.id ?? "" };
  const named = { title: open?.suggestedTitle ?? "" };

  return (
    <PageFrame
      titleKey={open ? "autopilot.signal" : "autopilot.title"}
      displayTitle={open?.suggestedTitle}
      variant="app"
      landmark={false}
    >
      {open ? (
        <SignalView
          workspaceId={workspaceId}
          signal={open}
          signals={ordered}
          message={message}
          problem={problem}
          onMove={setOpenId}
          onBack={() => {
            setCursor(open.id);
            setOpenId(null);
          }}
          actions={{
            canAccept: team.permissions.create,
            canReview: team.permissions.update,
            busy:
              acceptVote.isPending || dismiss.isPending || restore.isPending,
            onAcceptAsPost: () => setAccepting(open),
            onVote: () => {
              const post = open.matchedPost!;
              decide(
                open.id,
                () =>
                  acceptVote.mutateAsync({ param, json: { postId: post.id } }),
                t("autopilot.voted", { post: post.title }),
              );
            },
            onDismiss: () =>
              decide(
                open.id,
                () => dismiss.mutateAsync({ param }),
                t("autopilot.dismissedSignal", named),
              ),
            onRestore: () =>
              decide(
                open.id,
                () => restore.mutateAsync({ param }),
                t("autopilot.restored", named),
              ),
          }}
        />
      ) : (
        <SignalList
          status={status}
          onStatusChange={(value) => {
            setStatus(value);
            setCursor(null);
          }}
          message={message}
        >
          <TeamStateView
            loading={list.isLoading}
            problem={list.error ?? null}
            empty={!items.length}
            onRetry={() => void list.refetch()}
          >
            <SignalGroups
              workspaceId={workspaceId}
              groups={groups}
              cursor={cursor}
              onOpen={setOpenId}
              onLoadMore={
                list.hasNextPage ? () => void list.fetchNextPage() : undefined
              }
              loadingMore={list.isFetchingNextPage}
            />
          </TeamStateView>
        </SignalList>
      )}
      <AcceptPostSheet
        signal={accepting}
        boards={boards.data?.items ?? []}
        onClose={() => setAccepting(null)}
        onSubmit={async (values) => {
          const signalId = accepting?.id ?? "";
          await acceptPost.mutateAsync({
            param: { workspaceId, signalId },
            json: values,
          });
          setAccepting(null);
          setMessage(t("autopilot.created", { title: values.title }));
          setOpenId(after(signalId));
        }}
      />
    </PageFrame>
  );
}
