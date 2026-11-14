import { MessageSquareReply, StickyNote } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetTicketResponse } from "../../../api/team/get-ticket";
import { useAddTicketNote } from "../../../hooks/team/use-add-ticket-note";
import { useListTicketActivity } from "../../../hooks/team/use-list-ticket-activity";
import { useListTicketMessages } from "../../../hooks/team/use-list-ticket-messages";
import { useReplyTicket } from "../../../hooks/team/use-reply-ticket";
import { useTeamRuntime } from "../../../team/runtime";
import { TeamStateView } from "../../../team/team-state-view";
import { ActionBar } from "../../../ui/inbox/action-bar";
import { timeline } from "../timeline";
import { TicketComposerForm } from "./ticket-composer-form";
import { TicketTimeline } from "./ticket-timeline";

export interface TicketThreadProps {
  ticket: GetTicketResponse;
}

/** The middle pane of a ticket: the thread, the composer, and the Reply (R) and Note (N) bar. */
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
  const [mode, setMode] = useState<"reply" | "note" | null>(null);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
        <TeamStateView
          loading={messages.isLoading || activity.isLoading}
          problem={messages.error ?? activity.error ?? null}
          onRetry={() => {
            void messages.refetch();
            void activity.refetch();
          }}
        >
          <TicketTimeline
            entries={timeline(
              messages.data?.items ?? [],
              activity.data?.items ?? [],
            )}
          />
        </TeamStateView>
      </div>
      {mode ? (
        <TicketComposerForm
          key={mode}
          mode={mode}
          onCancel={() => setMode(null)}
          onSubmit={async ({ content }) => {
            const send = mode === "reply" ? reply : note;
            await send.mutateAsync({ param, json: { content } });
            setMode(null);
          }}
        />
      ) : null}
      {team.permissions.update ? (
        <ActionBar
          label={t("team-tickets.actions")}
          actions={[
            {
              id: "reply",
              label: t("team-tickets.reply"),
              shortcut: "r",
              icon: MessageSquareReply,
              onSelect: () => setMode("reply"),
            },
            {
              id: "note",
              label: t("team-tickets.addNote"),
              shortcut: "n",
              icon: StickyNote,
              onSelect: () => setMode("note"),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
