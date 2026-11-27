import { Lock, MessageSquareReply, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import {
  detectInternalContentInReply,
  extractMentionedPrincipalIds,
} from "../../../core/reply-safety";
import {
  clearThreadDraft,
  readThreadDraft,
  writeThreadDraft,
} from "../../../core/thread-draft";
import { useAddTicketNote } from "../../../hooks/team/use-add-ticket-note";
import { useListTicketActivity } from "../../../hooks/team/use-list-ticket-activity";
import { useListTicketMessages } from "../../../hooks/team/use-list-ticket-messages";
import { useReplyTicket } from "../../../hooks/team/use-reply-ticket";
import type { ThreadViewer } from "../../../hooks/team/use-thread-presence";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { Composer } from "../../../ui/inbox/composer";
import type { ComposerMode } from "../../../ui/inbox/inbox-types";
import { ReplyGuardrailBanner } from "../../../ui/inbox/reply-guardrail-banner";
import { ScheduleSendMenu } from "../../../ui/inbox/schedule-send-menu";
import { useKeyShortcuts } from "../../../ui/inbox/use-key-shortcuts";
import type { Teammate } from "../ticket-scope";
import { timeline } from "../timeline";
import { TicketTimeline } from "./ticket-timeline";

export interface TicketThreadProps {
  ticket: GetTicketResponse;
  people?: readonly Teammate[];
  viewers?: readonly ThreadViewer[];
  onReplyingChange?: (replying: boolean) => void;
}

type Mode = "reply" | "note";

/** The thread of a ticket and the composer pinned under it. R starts a reply, N a note (#324). */
export function TicketThread({
  ticket,
  people = [],
  viewers = [],
  onReplyingChange,
}: TicketThreadProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId: team.workspaceId, ticketId: ticket.id };
  // ponytail: the latest 100 messages (the API maximum); add "Load earlier" with `before` when threads grow longer.
  const messages = useListTicketMessages(
    { param, query: { includeInternal: "true", limit: "100" } },
    team.viewer,
  );
  const activity = useListTicketActivity({ param }, team.viewer);
  const reply = useReplyTicket(team.viewer);
  const note = useAddTicketNote(team.viewer);
  const can = {
    reply: team.permissions.update,
    note: Boolean(team.permissions.update || team.permissions.commentInternal),
  };
  const savedDraft = useMemo(
    () =>
      readThreadDraft(team.workspaceId, "ticket", ticket.id, team.viewer.id),
    [team.workspaceId, ticket.id, team.viewer.id],
  );
  const initialMode: Mode =
    savedDraft && can[savedDraft.mode]
      ? savedDraft.mode
      : can.reply
        ? "reply"
        : "note";
  const [mode, setMode] = useState<Mode>(initialMode);
  const effectiveMode: Mode = can[mode] ? mode : can.reply ? "reply" : "note";
  const [text, setText] = useState(savedDraft?.text ?? "");
  const [pendingConfirm, setPendingConfirm] = useState<{
    scheduledAt?: string;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const writer = can.reply || can.note;

  useEffect(() => {
    writeThreadDraft(
      team.workspaceId,
      "ticket",
      ticket.id,
      { text, mode: effectiveMode },
      team.viewer.id,
    );
  }, [team.workspaceId, ticket.id, text, effectiveMode, team.viewer.id]);

  const isReplyingState = effectiveMode === "reply" && Boolean(text.trim());
  useEffect(() => {
    onReplyingChange?.(isReplyingState);
  }, [isReplyingState, onReplyingChange]);

  const switchMode = (next: Mode, shouldFocus = false) => {
    if (!can[next]) return;
    setMode(next);
    setPendingConfirm(null);
    if (shouldFocus) input.current?.focus();
  };

  const compose = (next: Mode) =>
    can[next] ? () => switchMode(next, true) : undefined;
  useKeyShortcuts({ r: compose("reply"), n: compose("note") }, writer);
  const send = effectiveMode === "reply" ? reply : note;
  const requester = {
    name: ticket.requester?.displayName ?? t("team-tickets.noRequester"),
    avatarUrl: ticket.requester?.avatarUrl,
  };

  const modes: ComposerMode[] = [
    ...(can.reply
      ? [
          {
            value: "reply",
            label: t("team-tickets.reply"),
            icon: MessageSquareReply,
            description: t("inbox.replyContext", { name: requester.name }),
            sendLabel: t("inbox.replySend"),
            sendIcon: Send,
          },
        ]
      : []),
    ...(can.note
      ? [
          {
            value: "note",
            label: t("team-tickets.note"),
            icon: Lock,
            private: true,
            description: t("inbox.noteContext"),
            sendLabel: t("inbox.noteSend"),
            sendIcon: Lock,
          },
        ]
      : []),
  ];

  const internalWarning = useMemo(
    () =>
      effectiveMode === "reply"
        ? detectInternalContentInReply(text, people)
        : null,
    [effectiveMode, text, people],
  );
  const replyingTeammates = useMemo(
    () =>
      effectiveMode === "reply"
        ? viewers.filter((viewer) => viewer.state === "replying")
        : [],
    [effectiveMode, viewers],
  );

  const performSend = (scheduledAt?: string) => {
    if (send.isPending) return;
    const trimmed = text.trim();
    const onSuccess = () => {
      setText("");
      setPendingConfirm(null);
      clearThreadDraft(team.workspaceId, "ticket", ticket.id, team.viewer.id);
    };
    if (effectiveMode === "reply") {
      reply.mutate(
        {
          param,
          json: {
            content: trimmed,
            ...(scheduledAt ? { scheduledAt } : {}),
          },
        },
        { onSuccess },
      );
    } else {
      const mentionPrincipalIds = extractMentionedPrincipalIds(trimmed, people);
      note.mutate(
        {
          param,
          json: {
            content: trimmed,
            ...(mentionPrincipalIds.length ? { mentionPrincipalIds } : {}),
          },
        },
        { onSuccess },
      );
    }
  };

  const handleSend = (scheduledAt?: string) => {
    if (
      effectiveMode === "reply" &&
      internalWarning?.flagged &&
      !pendingConfirm
    ) {
      setPendingConfirm({ scheduledAt });
      return;
    }
    performSend(scheduledAt ?? pendingConfirm?.scheduledAt);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The reversed column keeps the newest message in view, without script. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="mx-auto mb-auto w-full max-w-200 px-4 py-4 [&>[role=alert]]:m-4">
          <TeamStateView
            loading={messages.isLoading || activity.isLoading}
            problem={messages.error ?? activity.error ?? null}
            onRetry={() => {
              void messages.refetch();
              void activity.refetch();
            }}
          >
            <TicketTimeline
              requester={requester}
              people={people}
              entries={timeline(
                messages.data?.items ?? [],
                activity.data?.items ?? [],
              )}
              onRestoreDraft={(content) => {
                if (can.reply) setMode("reply");
                setText(content);
                setPendingConfirm(null);
                requestAnimationFrame(() => input.current?.focus());
              }}
            />
          </TeamStateView>
        </div>
      </div>
      {writer ? (
        <div className="mx-auto w-full max-w-200 shrink-0 px-4 pb-4">
          <Composer
            label={
              effectiveMode === "reply"
                ? t("team-tickets.replyTo", { name: requester.name })
                : t("team-tickets.noteLabel")
            }
            value={text}
            onChange={(value) => {
              setText(value);
              setPendingConfirm(null);
            }}
            onSend={() => handleSend()}
            modes={modes}
            mode={effectiveMode}
            onModeChange={(next) => switchMode(next as Mode)}
            sending={send.isPending}
            inputRef={input}
            sendExtra={
              effectiveMode === "reply" && can.reply ? (
                <ScheduleSendMenu
                  disabled={!text.trim() || send.isPending}
                  onSchedule={(isoDate) => handleSend(isoDate)}
                />
              ) : null
            }
            banner={
              <ReplyGuardrailBanner
                internalWarning={internalWarning}
                confirmingSend={pendingConfirm !== null}
                sending={send.isPending}
                replyingTeammates={replyingTeammates}
                canSwitchToNote={can.note}
                onSwitchToNote={() => switchMode("note", true)}
                onConfirmSendAnyway={() =>
                  performSend(pendingConfirm?.scheduledAt)
                }
              />
            }
          />
          {send.error ? (
            <p
              role="alert"
              className="mt-1 text-xs text-destructive-foreground"
            >
              {t("team-tickets.sendFailed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
