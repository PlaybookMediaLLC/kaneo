import { Fragment, useEffect, useRef, type RefObject } from "react";
import { useConversationScroll } from "./useConversationScroll.js";
import { AttachmentGallery } from "./AttachmentGallery.js";
import { Composer } from "./Composer.js";
import { FeedbackCard } from "./FeedbackCard.js";
import { MessageFiles } from "./MessageFiles.js";
import { messageTime } from "./message-time.js";
import type { Conversation } from "./types.js";
import type { Draft } from "./useDrafts.js";
import { useLocale, useT } from "./i18n/useT.js";

export function ConversationView({
  conversation,
  attachmentsEnabled,
  attachmentReset,
  onFilesChange,
  draft,
  onChange,
  onReply,
  offline,
  onRead,
  reading,
  readError,
  scrollContainer,
  onOpenFile,
  onConfirmCard,
}: {
  conversation: Conversation;
  attachmentsEnabled?: boolean;
  attachmentReset?: number;
  onFilesChange?: (files: readonly File[]) => void;
  draft: Draft;
  onChange: (body: string) => void;
  onReply?: () => void;
  offline: boolean;
  onRead?: () => void;
  reading: boolean;
  readError: string;
  scrollContainer: RefObject<HTMLDivElement | null>;
  /** Resolves with a short-lived download URL of a file of this conversation. */
  onOpenFile?: (fileId: string) => Promise<string>;
  onConfirmCard?: (
    messageId: string,
    card: { title: string; body: string },
  ) => Promise<unknown>;
}) {
  const t = useT();
  const locale = useLocale();
  const scroll = useConversationScroll(conversation, scrollContainer);
  const acknowledged = useRef(false);
  useEffect(() => {
    // Capture and position the opening unread boundary before a host can clear it.
    if (!acknowledged.current) {
      acknowledged.current = true;
      onRead?.();
    }
  }, [onRead]);
  const stamps = conversation.messages.map((message) =>
    messageTime(message.sentAt, locale),
  );
  return (
    <article className="qb-conversation-view">
      <div
        className="qb-thread"
        ref={scroll.thread}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={conversation.title}
      >
        <h1>{conversation.title}</h1>
        {(conversation.unreadCount ?? 0) > 0 && onRead && (
          <button
            type="button"
            className="qb-text-button"
            disabled={reading || offline}
            onClick={onRead}
          >
            {reading ? t("Marking as read…") : t("Mark as read")}
          </button>
        )}
        {readError && (
          <p className="qb-form-error" role="alert">
            {readError}
          </p>
        )}
        {conversation.messages.map((message, index) => {
          const stamp = stamps[index];
          const newDay = stamp?.day !== stamps[index - 1]?.day;
          const previous = conversation.messages[index - 1];
          const grouped =
            !newDay &&
            previous?.author === message.author &&
            previous?.fromVisitor === message.fromVisitor;
          return (
            <Fragment key={message.id}>
              {message.id === scroll.firstUnread && (
                <div className="qb-unread-divider" ref={scroll.unread}>
                  {t("New messages")}
                </div>
              )}
              {newDay && stamp && <p className="qb-message-day">{stamp.day}</p>}
              <div
                className="qb-message"
                data-visitor={message.fromVisitor ?? false}
                data-grouped={grouped}
              >
                <strong>
                  {message.fromAssistant ? t("Assistant") : message.author}
                </strong>
                <p>{message.body}</p>
                {message.feedbackCard && (
                  <FeedbackCard
                    card={message.feedbackCard}
                    offline={offline}
                    onConfirm={
                      onConfirmCard &&
                      (() => onConfirmCard(message.id, message.feedbackCard!))
                    }
                  />
                )}
                <AttachmentGallery attachments={message.attachments} />
                <MessageFiles files={message.files} onOpen={onOpenFile} />
                {(stamp || message.fromVisitor) && (
                  <span className="qb-message-meta">
                    {stamp && <time dateTime={stamp.iso}>{stamp.time}</time>}
                    {message.fromVisitor && <span>{t("Sent")}</span>}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
      {scroll.away && (
        <button
          type="button"
          className="qb-jump-latest"
          onClick={() => {
            scroll.jump();
            scrollContainer.current?.focus({ preventScroll: true });
          }}
        >
          {t("Jump to latest")}
        </button>
      )}
      <Composer
        kind="reply"
        attachmentsEnabled={attachmentsEnabled}
        attachmentReset={attachmentReset}
        onFilesChange={onFilesChange}
        draft={draft}
        onChange={onChange}
        onSubmit={onReply}
        offline={offline}
      />
    </article>
  );
}
