import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Viewer } from "../../core/types";
import { listConversationViewersQuery } from "../../api/team/list-conversation-viewers";
import { setConversationViewer } from "../../api/team/set-conversation-viewer";
import { listTicketViewersQuery } from "../../api/team/list-ticket-viewers";
import { setTicketViewer } from "../../api/team/set-ticket-viewer";

export type ThreadViewerState = "viewing" | "replying";

export interface ThreadViewer {
  principalId: string;
  displayName: string | null;
  avatarUrl: string | null;
  state: ThreadViewerState;
  updatedAt: string;
}

const HEARTBEAT_MS = 12_000;
const POLL_MS = 5_000;

/**
 * Heartbeats the current teammate's viewing/replying state and polls other teammates
 * on the same conversation or ticket for collision detection (#324).
 */
export function useThreadPresence(
  kind: "conversation" | "ticket",
  workspaceId: string,
  threadId: string,
  viewer: Viewer,
  state: ThreadViewerState = "viewing",
): readonly ThreadViewer[] {
  const enabled = Boolean(workspaceId && threadId);
  const convQuery = useQuery({
    ...listConversationViewersQuery(
      { param: { workspaceId, conversationId: threadId } },
      viewer,
    ),
    enabled: enabled && kind === "conversation",
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const ticketQuery = useQuery({
    ...listTicketViewersQuery(
      { param: { workspaceId, ticketId: threadId } },
      viewer,
    ),
    enabled: enabled && kind === "ticket",
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  const beat = useMutation({
    mutationFn: (nextState: ThreadViewerState) =>
      kind === "conversation"
        ? setConversationViewer({
            param: { workspaceId, conversationId: threadId },
            json: { state: nextState },
          })
        : setTicketViewer({
            param: { workspaceId, ticketId: threadId },
            json: { state: nextState },
          }),
  });
  const mutateRef = useRef(beat.mutate);
  mutateRef.current = beat.mutate;

  useEffect(() => {
    if (!enabled) return;
    mutateRef.current(state);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        mutateRef.current(state);
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [enabled, kind, workspaceId, threadId, state]);

  return (
    (kind === "conversation"
      ? convQuery.data?.viewers
      : ticketQuery.data?.viewers) ?? []
  );
}
