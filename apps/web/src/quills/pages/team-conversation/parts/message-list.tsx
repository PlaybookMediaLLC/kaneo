import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { redactConversationMessage } from "@/fetchers/quills/privacy";
import type { ListConversationMessagesResponse } from "../../../api/team/list-conversation-messages";
import { useGetConversationTyping } from "../../../hooks/team/use-get-conversation-typing";
import {
  useRecallScheduledMessage,
  useSendScheduledMessageNow,
} from "../../../hooks/team/use-scheduled-send";
import { useTeamRuntime } from "../../../team/runtime";
import { teamHref } from "../../../team/team-href";
import { DateSeparator } from "../../../ui/inbox/date-separator";
import { MessageBubble } from "../../../ui/inbox/message-bubble";
import { ScheduledSendFooter } from "../../../ui/inbox/scheduled-send-footer";
import { SystemEvent } from "../../../ui/inbox/system-event";
import { arrivedClass, useArrived } from "../../../ui/inbox/use-arrived";
import { PageContext } from "../../../ui/page-context";
import { cn, ConfirmDialog, toast } from "../../../ui/upstream";
import type { Teammate } from "../../team-conversations/conversation-list";
import { AttachmentLink } from "./attachment-link";
import { eventIcons } from "../event-icons";

type Message = ListConversationMessagesResponse["items"][number];

export interface MessageListProps {
  workspaceId: string;
  conversationId: string;
  closed?: boolean;
  /** Newest first, as the API returns them. */
  messages: readonly Message[];
  customerName: string;
  customerAvatarUrl?: string | null;
  /** The teammates, for the avatars of team replies. */
  people: readonly Teammate[];
  /** Called when a scheduled/undo-send reply is recalled so its text returns to the composer. */
  onRestoreDraft?: (content: string) => void;
}

// Resolve and reopen notices name the teammate who acted: "You resolved this conversation".
const actorKeys: Record<string, { you: string; named: string }> = {
  chat_ended: {
    you: "team-conversations.events.resolvedByYou",
    named: "team-conversations.events.resolvedBy",
  },
  chat_reopened: {
    you: "team-conversations.events.reopenedByYou",
    named: "team-conversations.events.reopenedBy",
  },
};

const day = (iso: string) => new Date(iso).toDateString();

/** The thread (design section 2): day separators, customer messages left, team replies and notes
 * right, events as centered lines and the customer's typing. The newest message scrolls in. */
export function MessageList(props: MessageListProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const queryClient = useQueryClient();
  const [redactTarget, setRedactTarget] = useState<string | null>(null);
  const [redacting, setRedacting] = useState(false);
  const recall = useRecallScheduledMessage(team.viewer);
  const sendNow = useSendScheduledMessageNow(team.viewer);
  const typing = useGetConversationTyping(
    {
      param: {
        workspaceId: props.workspaceId,
        conversationId: props.closed ? "" : props.conversationId,
      },
    },
    team.viewer,
  );
  const end = useRef<HTMLParagraphElement>(null);
  const newest = props.messages[0]?.id;
  useEffect(() => {
    if (newest) end.current?.scrollIntoView?.({ block: "end" });
  }, [newest]);
  const messages = [...props.messages].reverse();
  const arrived = useArrived(
    messages.map((message) => message.id),
    props.conversationId,
  );
  const peopleById = new Map(props.people.map((person) => [person.id, person]));
  const avatar = (id: string | null) =>
    id ? peopleById.get(id)?.avatarUrl : undefined;
  const me = props.people.find((person) => person.userId === team.viewer.id);
  // An unknown teammate, automation and older rows keep the stored text.
  const eventText = (message: Message) => {
    const keys = actorKeys[message.systemKind ?? ""];
    const actor = message.systemActorPrincipalId;
    if (!keys || !actor) return message.content;
    if (actor === me?.id) return t(keys.you);
    const name = peopleById.get(actor)?.name;
    return name ? t(keys.named, { name }) : message.content;
  };
  const confirmRedact = async () => {
    if (!redactTarget) return;
    setRedacting(true);
    try {
      await redactConversationMessage(
        props.workspaceId,
        props.conversationId,
        redactTarget,
        { mode: "both", reason: "Sensitive data redacted" },
      );
      setRedactTarget(null);
      await queryClient.invalidateQueries();
      toast.success(t("team-conversations.redacted"));
    } catch {
      toast.error(t("team-conversations.problem.failed"));
    } finally {
      setRedacting(false);
    }
  };
  return (
    <section
      aria-labelledby="conversation-thread"
      className="mx-auto grid w-full max-w-200 gap-3"
    >
      <h2 id="conversation-thread" className="sr-only">
        {t("team-conversations.thread")}
      </h2>
      {messages.length ? null : (
        <p className="text-sm text-muted-foreground">
          {t("team-conversations.noMessages")}
        </p>
      )}
      <ol className="grid gap-3">
        {messages.map((message, index) => (
          <li
            key={message.id}
            className={cn("grid gap-3", arrived(message.id) && arrivedClass)}
          >
            {index === 0 ||
            day(messages[index - 1]!.createdAt) !== day(message.createdAt) ? (
              <DateSeparator date={message.createdAt} />
            ) : null}
            {message.senderType === "system" ? (
              <SystemEvent
                icon={eventIcons[message.systemKind ?? ""]}
                time={message.createdAt}
              >
                {eventText(message)}
              </SystemEvent>
            ) : (
              <MessageBubble
                kind={
                  message.isInternal
                    ? "note"
                    : message.senderType === "agent"
                      ? "self"
                      : "other"
                }
                author={
                  message.senderType === "visitor"
                    ? {
                        name: props.customerName,
                        avatarUrl: props.customerAvatarUrl,
                      }
                    : {
                        name:
                          message.authorName ??
                          t("team-conversations.teammate"),
                        avatarUrl: avatar(message.authorPrincipalId),
                      }
                }
                time={message.createdAt}
                footer={
                  message.sendStatus === "scheduled" &&
                  message.scheduledSendAt ? (
                    <ScheduledSendFooter
                      scheduledSendAt={message.scheduledSendAt}
                      recalling={
                        recall.isPending &&
                        recall.variables?.param.messageId === message.id
                      }
                      sendingNow={
                        sendNow.isPending &&
                        sendNow.variables?.param.messageId === message.id
                      }
                      canManage={
                        team.permissions.update &&
                        (message.authorPrincipalId === me?.id ||
                          team.permissions.manageSettings)
                      }
                      error={
                        (recall.error &&
                          recall.variables?.param.messageId === message.id) ||
                        (sendNow.error &&
                          sendNow.variables?.param.messageId === message.id)
                          ? t("core.problem.failed")
                          : null
                      }
                      onUndo={() => {
                        recall.reset();
                        sendNow.reset();
                        recall.mutate(
                          {
                            param: {
                              workspaceId: props.workspaceId,
                              messageId: message.id,
                            },
                          },
                          {
                            onSuccess: (res) =>
                              props.onRestoreDraft?.(res.content),
                          },
                        );
                      }}
                      onSendNow={() => {
                        recall.reset();
                        sendNow.reset();
                        sendNow.mutate({
                          param: {
                            workspaceId: props.workspaceId,
                            messageId: message.id,
                          },
                        });
                      }}
                    />
                  ) : null
                }
              >
                {message.content ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : null}
                {/* A request shared from the right panel is an embed with no text. */}
                {message.embeds
                  .filter((embed) => embed.kind === "post")
                  .map((embed) => (
                    <Link
                      key={`${message.id}:${embed.id}`}
                      to={teamHref(props.workspaceId, `/posts/${embed.id}`)}
                      className="block underline underline-offset-4"
                    >
                      {t("team-conversations.sharedRequest")}
                    </Link>
                  ))}
                {message.attachments.map((file, index) => (
                  <AttachmentLink
                    key={file.fileId ?? `${message.id}:${index}`}
                    workspaceId={props.workspaceId}
                    fileId={file.fileId}
                    name={file.name}
                  />
                ))}
                {message.redactedAt ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldAlert className="size-3.5" aria-hidden="true" />
                    {t("team-conversations.redactedBadge", {
                      name:
                        message.redactedByName ??
                        t("team-conversations.teammate"),
                      date: new Date(message.redactedAt).toLocaleDateString(),
                    })}
                  </p>
                ) : team.permissions.update ? (
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setRedactTarget(message.id)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {t("team-conversations.redactAction")}
                    </button>
                  </div>
                ) : null}
                {message.senderType === "visitor" ? (
                  <PageContext
                    context={message.widgetMetadata}
                    className="mt-1 opacity-80"
                  />
                ) : null}
              </MessageBubble>
            )}
          </li>
        ))}
      </ol>
      <p
        ref={end}
        role="status"
        className="min-h-5 text-xs text-muted-foreground"
      >
        {typing.data?.visitorTyping
          ? t("team-conversations.typing", { name: props.customerName })
          : null}
      </p>
      <ConfirmDialog
        open={Boolean(redactTarget)}
        onOpenChange={(open) => {
          if (!open) setRedactTarget(null);
        }}
        title={t("team-conversations.redactTitle")}
        description={t("team-conversations.redactText")}
        confirmLabel={t("team-conversations.redactAction")}
        pending={redacting}
        onConfirm={() => void confirmRedact()}
      />
    </section>
  );
}
