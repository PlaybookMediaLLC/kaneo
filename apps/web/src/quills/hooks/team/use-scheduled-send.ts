import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  getUndoSendSettingsQuery,
  type GetUndoSendSettingsRequest,
} from "../../api/team/get-undo-send-settings";
import {
  setUndoSendSettings,
  type SetUndoSendSettingsRequest,
  type SetUndoSendSettingsResponse,
} from "../../api/team/set-undo-send-settings";
import {
  recallScheduledMessage,
  sendScheduledMessageNow,
  type RecallScheduledMessageRequest,
  type RecallScheduledMessageResponse,
  type SendScheduledMessageNowRequest,
  type SendScheduledMessageNowResponse,
} from "../../api/team/recall-scheduled-message";

const THREAD_OPERATIONS = [
  "listConversationMessages",
  "listTicketMessages",
  "getConversation",
  "listConversations",
  "getTicket",
  "listTickets",
  "listTicketActivity",
] as const;

export function useGetUndoSendSettings(
  input: GetUndoSendSettingsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getUndoSendSettingsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}

export function useSetUndoSendSettings(viewer: Viewer) {
  const client = useQueryClient();
  return useMutation<
    SetUndoSendSettingsResponse,
    PortalProblem,
    SetUndoSendSettingsRequest
  >({
    mutationFn: setUndoSendSettings,
    onSuccess: async (_data, input) => {
      await client.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getUndoSendSettings",
        ),
      });
    },
  });
}

export function useRecallScheduledMessage(viewer: Viewer) {
  const client = useQueryClient();
  return useMutation<
    RecallScheduledMessageResponse,
    PortalProblem,
    RecallScheduledMessageRequest
  >({
    mutationFn: recallScheduledMessage,
    onSuccess: async (_data, input) => {
      await Promise.all(
        THREAD_OPERATIONS.map((operation) =>
          client.invalidateQueries({
            queryKey: quillsOperationKey(
              input.param.workspaceId,
              viewer,
              "team",
              operation,
            ),
          }),
        ),
      );
    },
  });
}

export function useSendScheduledMessageNow(viewer: Viewer) {
  const client = useQueryClient();
  return useMutation<
    SendScheduledMessageNowResponse,
    PortalProblem,
    SendScheduledMessageNowRequest
  >({
    mutationFn: sendScheduledMessageNow,
    onSuccess: async (_data, input) => {
      await Promise.all(
        THREAD_OPERATIONS.map((operation) =>
          client.invalidateQueries({
            queryKey: quillsOperationKey(
              input.param.workspaceId,
              viewer,
              "team",
              operation,
            ),
          }),
        ),
      );
    },
  });
}
