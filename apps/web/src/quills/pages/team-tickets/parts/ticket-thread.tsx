import { MessageSquareReply, StickyNote } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useAddTicketNote } from "../../../hooks/team/use-add-ticket-note";
import { useListTicketActivity } from "../../../hooks/team/use-list-ticket-activity";
import { useListTicketMessages } from "../../../hooks/team/use-list-ticket-messages";
import { useReplyTicket } from "../../../hooks/team/use-reply-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { Composer } from "../../../ui/inbox/composer";
import { useKeyShortcuts } from "../../../ui/inbox/use-key-shortcuts";
import { timeline } from "../timeline";
import { TicketTimeline } from "./ticket-timeline";

export interface TicketThreadProps {
  ticket: GetTicketResponse;
}

type Mode = "reply" | "note";

/** The thread of a ticket and the composer pinned under it. R starts a reply, N a note. */
export function TicketThread({ ticket }: TicketThreadProps) {
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
  const [mode, setMode] = useState<Mode>("reply");
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const writer = team.permissions.update;
  const compose = (next: Mode) => () => {
    setMode(next);
    input.current?.focus();
  };
  useKeyShortcuts({ r: compose("reply"), n: compose("note") }, writer);
  const send = mode === "reply" ? reply : note;
  const requester = {
    name: ticket.requester?.displayName ?? t("team-tickets.noRequester"),
    avatarUrl: ticket.requester?.avatarUrl,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The reversed column keeps the newest message in view, without script. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div className="mx-auto mb-auto w-full max-w-205 px-4 py-4 [&>[role=alert]]:m-4">
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
              entries={timeline(
                messages.data?.items ?? [],
                activity.data?.items ?? [],
              )}
            />
          </TeamStateView>
        </div>
      </div>
      {writer ? (
        <div className="mx-auto w-full max-w-205 shrink-0 px-4 pb-4">
          <Composer
            label={
              mode === "reply"
                ? t("team-tickets.replyTo", { name: requester.name })
                : t("team-tickets.noteLabel")
            }
            value={text}
            onChange={setText}
            onSend={() =>
              send.mutate(
                { param, json: { content: text.trim() } },
                { onSuccess: () => setText("") },
              )
            }
            modes={[
              {
                value: "reply",
                label: t("team-tickets.reply"),
                icon: MessageSquareReply,
              },
              {
                value: "note",
                label: t("team-tickets.note"),
                icon: StickyNote,
                private: true,
              },
            ]}
            mode={mode}
            onModeChange={(next) => setMode(next as Mode)}
            sending={send.isPending}
            inputRef={input}
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
