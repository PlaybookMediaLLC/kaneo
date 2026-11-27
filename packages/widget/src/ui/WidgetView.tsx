import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { HomeView } from "./HomeView.js";
import { MessagesView } from "./MessagesView.js";
import { HelpView } from "./HelpView.js";
import { FeedbackView } from "./FeedbackView.js";
import { FeedbackDetail } from "./FeedbackDetail.js";
import { UpdatesView } from "./UpdatesView.js";
import { UpdateDetail } from "./UpdateDetail.js";
import { safeMediaUrl } from "./media.js";
import { Composer } from "./Composer.js";
import { ConversationView } from "./ConversationView.js";
import { ActivityView } from "./ActivityView.js";
import { ArticleView } from "./ArticleView.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { SurveyPrompt } from "./SurveyPrompt.js";
import { useDrafts, emptyDraft } from "./useDrafts.js";
import {
  useWidgetNavigation,
  type WidgetRoute,
} from "./useWidgetNavigation.js";
import { useAction } from "./useAction.js";
import type {
  WidgetTab,
  WidgetViewProps,
  HelpFilters,
  FeedbackFilters,
  SubmissionOptions,
} from "./types.js";
import { isRtl, widgetLocale } from "./i18n/locales.js";
import type { MessageKey } from "./i18n/messages/en.js";
import { LocaleProvider, useLocale, useT } from "./i18n/useT.js";

const tabs: { id: WidgetTab; label: MessageKey }[] = [
  { id: "home", label: "Home" },
  { id: "messages", label: "Messages" },
  { id: "help", label: "Help" },
  { id: "feedback", label: "Feedback" },
  { id: "updates", label: "Updates" },
];

/** The widget panel in the visitor's language: `locale` picks the copy and the text direction. */
export function WidgetView(props: WidgetViewProps) {
  return (
    <LocaleProvider locale={widgetLocale(props.locale)}>
      <WidgetViewBody {...props} />
    </LocaleProvider>
  );
}

function WidgetViewBody({
  brandName = "Quills",
  dir,
  identified = false,
  theme = "auto",
  initialTab = "home",
  tabs: enabledTabs,
  feedback = [],
  articles = [],
  updates = [],
  conversations = [],
  activities = [],
  onReadActivity,
  contactEmail,
  onRequestContactEmail,
  onConfirmContactEmail,
  onArticleFeedback,
  loadState = "ready",
  connection = "online",
  onRetryLoad,
  teamAvailability,
  team,
  replyTime,
  greeting,
  teamMember,
  attachmentsEnabled,
  onCaptureScreenshot,
  onExpandedChange,
  onOpenItem,
  navigation,
  onCommentFeedback,
  onVoteComment,
  onClose,
  closable = true,
  onOpenPortal,
  onChangeAvatar,
  onSendMessage,
  onSubmitFeedback,
  onDraftFeedback,
  feedbackFields,
  onReplyMessage,
  onConfirmFeedbackCard,
  onHandoffConversation,
  onReadConversation,
  onOpenFile,
  onReadUpdate,
  onVoteFeedback,
  onFindSimilar,
  updatesSubscribed,
  onSubscribeUpdates,
  onFollowFeedback,
  onReactToUpdate,
  onShareUpdate,
  survey,
  onAnswerSurvey,
  onDismissSurvey,
}: WidgetViewProps) {
  const t = useT();
  const locale = useLocale();
  const [attachmentReset, setAttachmentReset] = useState(0);
  const close = () => {
    nav.content.current
      ?.querySelectorAll("dialog")
      .forEach((dialog) => dialog.close());
    setAttachmentReset((value) => value + 1);
    onClose();
  };
  const nav = useWidgetNavigation(initialTab);
  const has = (id: WidgetTab) => !enabledTabs || enabledTabs.includes(id);
  const shownTabs = tabs.filter((item) => has(item.id));
  // A tab that the workspace turned off (an initial tab, a deep link, history) shows the first one that is on.
  const route: WidgetRoute =
    has(nav.route.tab) || !shownTabs[0] ? nav.route : { tab: shownTabs[0].id };
  const { tab, detail: selected, composer } = route;
  const composeKey = route.articleId
    ? `message:article:${route.articleId}`
    : (composer ?? "");
  const contextArticle = articles.find((item) => item.id === route.articleId);
  const expanded = !!selected && (tab === "help" || tab === "updates");
  const expansionCallback = useRef(onExpandedChange);
  useEffect(() => {
    expansionCallback.current = onExpandedChange;
  }, [onExpandedChange]);
  useEffect(() => {
    expansionCallback.current?.(expanded);
  }, [expanded]);
  useEffect(() => () => expansionCallback.current?.(false), []);
  const [notice, setNotice] = useState("");
  const [helpFilters, setHelpFilters] = useState<HelpFilters>({
    query: "",
    category: null,
  });
  const [feedbackFilters, setFeedbackFilters] = useState<FeedbackFilters>({
    query: "",
    sort: "default",
    status: "all",
  });
  const draftStore = useDrafts();
  const read = useAction();
  const readState = read.forKey(`${tab}:${selected}`);
  const offline = connection !== "online";
  const navigate = (next: WidgetTab) => {
    nav.navigate(next);
    setNotice("");
  };
  const compose = (kind: "message" | "feedback") => {
    nav.go({ tab, composer: kind });
    setNotice("");
  };
  const markConversationRead = (id: string) => {
    const item = conversations.find((item) => item.id === id);
    const last = item?.messages[item.messages.length - 1];
    if (!offline && onReadConversation && last && (item?.unreadCount ?? 0) > 0)
      void read.run(() => onReadConversation(id, last.id), `messages:${id}`);
  };
  const open = (next: WidgetTab, id: string) => {
    nav.go({ tab: next, detail: id });
    setNotice("");
    onOpenItem?.(next, id);
    if (
      next === "updates" &&
      !offline &&
      onReadUpdate &&
      updates.find((item) => item.id === id)?.unread
    )
      void read.run(() => onReadUpdate(id), `updates:${id}`);
  };
  const requested = useRef(navigation);
  useEffect(() => {
    // Only a new request object navigates; the first render keeps initialTab.
    if (!navigation || navigation === requested.current) return;
    requested.current = navigation;
    if (navigation.detail) open(navigation.tab, navigation.detail);
    else if (navigation.activity)
      nav.go({ tab: navigation.tab, activity: true });
    else if (navigation.composer) {
      nav.go({ tab: navigation.tab, composer: navigation.composer });
      if (navigation.draft && !draftStore.drafts[navigation.composer]?.body)
        draftStore.change(navigation.composer, navigation.draft);
    } else navigate(navigation.tab);
  });
  // A help deep link's search text and category, matched by name once articles load.
  const helpRequest = useRef(navigation);
  useEffect(() => {
    if (navigation?.tab !== "help" || navigation === helpRequest.current)
      return;
    const { query, category } = navigation;
    const named = category?.toLowerCase();
    const match = named
      ? articles.find((item) => item.category.toLowerCase() === named)?.category
      : undefined;
    if (named && !match && articles.length === 0) return;
    helpRequest.current = navigation;
    if (query !== undefined || match)
      setHelpFilters((filters) => ({
        ...filters,
        ...(query !== undefined && { query }),
        ...(match && { category: match }),
      }));
  }, [navigation, articles]);
  const article =
    tab === "help" ? articles.find((item) => item.id === selected) : undefined;
  const post =
    tab === "feedback"
      ? feedback.find((item) => item.id === selected)
      : undefined;
  const update =
    tab === "updates"
      ? updates.find((item) => item.id === selected)
      : undefined;
  const conversation =
    tab === "messages"
      ? conversations.find((item) => item.id === selected)
      : undefined;
  const unreadMessages = conversations.reduce(
    (sum, item) => sum + Math.max(0, item.unreadCount ?? 0),
    0,
  );
  const unreadUpdates = updates.filter((item) => item.unread).length;
  const submission = composer === "message" ? onSendMessage : onSubmitFeedback;
  const submit = (
    extra?: Pick<SubmissionOptions, "title" | "boardId" | "customFields">,
  ) => {
    if (!composer || !submission || offline) return;
    const origin = nav.key;
    void draftStore.submit(
      composeKey,
      (body, options) =>
        submission(body, {
          ...options,
          ...(route.articleId ? { articleId: route.articleId } : {}),
          ...(composer === "feedback" && extra),
        }),
      () => {
        if (nav.currentKey.current !== origin) return;
        navigate(composer === "message" ? "messages" : "feedback");
        setNotice(
          composer === "message"
            ? t("Message sent.")
            : t("Feedback submitted."),
        );
      },
    );
  };
  return (
    <section
      className="qb-widget"
      tabIndex={-1}
      data-theme={theme}
      data-expanded={expanded}
      data-composer={composer}
      aria-label={t("{brand} support", { brand: brandName })}
      lang={locale}
      dir={dir ?? (isRtl(locale) ? "rtl" : "ltr")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="qb-header">
        {nav.canGoBack ? (
          <>
            <button
              type="button"
              className="qb-icon-button"
              aria-label={t("Back")}
              onClick={() => {
                nav.back();
                setNotice("");
              }}
            >
              <Icon name="back" />
            </button>
            <strong>
              {composer === "feedback"
                ? t("Give feedback")
                : post
                  ? t("Request")
                  : conversation
                    ? t("Conversation")
                    : ""}
            </strong>
          </>
        ) : (
          <>
            <span className="qb-brand-mark">
              <Icon name="messages" />
            </span>
            <strong>{brandName}</strong>
          </>
        )}
        {!nav.canGoBack && (!!onReadActivity || activities.length > 0) && (
          <button
            type="button"
            className="qb-icon-button qb-activity-trigger"
            aria-label={
              activities.some((item) => item.unread)
                ? t("Activity, unread updates")
                : t("Activity")
            }
            onClick={() => nav.go({ tab, activity: true })}
          >
            <Icon name="inbox" />
            {activities.some((item) => item.unread) && (
              <span className="qb-unread-dot" />
            )}
          </button>
        )}
        {article?.url && safeMediaUrl(article.url) && (
          <a
            className="qb-icon-button qb-external"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("Open article in new tab")}
          >
            <Icon name="external" />
          </a>
        )}
        {closable && (
          <button
            type="button"
            className="qb-icon-button qb-close"
            aria-label={t("Close widget")}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        )}
      </header>
      <ConnectionStatus
        loadState={loadState}
        connection={connection}
        onRetry={onRetryLoad}
      />
      <div className="qb-content" ref={nav.content} tabIndex={-1}>
        {notice && (
          <p className="qb-notice" role="status">
            {notice}
          </p>
        )}
        {route.activity ? (
          <ActivityView
            activities={activities}
            onRead={onReadActivity}
            offline={offline}
            onOpen={(id) => open("feedback", id)}
          />
        ) : composer ? (
          <Composer
            key={composeKey}
            kind={composer}
            articleContext={contextArticle?.title}
            draft={draftStore.drafts[composeKey] ?? emptyDraft}
            onChange={(body) => draftStore.change(composeKey, body)}
            onSubmit={submission ? submit : undefined}
            offline={offline}
            articles={articles}
            posts={feedback}
            onOpenPost={(id) => open("feedback", id)}
            onFindSimilar={onFindSimilar}
            onVote={onVoteFeedback}
            teamMember={teamMember}
            attachmentsEnabled={
              attachmentsEnabled === true ||
              (attachmentsEnabled === "feedback" && composer === "feedback")
            }
            attachmentReset={attachmentReset}
            onFilesChange={(files) => draftStore.changeFiles(composeKey, files)}
            onCapture={onCaptureScreenshot}
            onOpenArticle={(id) => open("help", id)}
            onBrowseHelp={() => nav.go({ tab: "help" })}
            onDraft={composer === "feedback" ? onDraftFeedback : undefined}
            fields={composer === "feedback" ? feedbackFields : undefined}
          />
        ) : article ? (
          <ArticleView
            key={article.id}
            article={article}
            offline={offline}
            onFeedback={onArticleFeedback}
            onContact={
              onSendMessage
                ? () =>
                    nav.go({
                      tab: "messages",
                      composer: "message",
                      articleId: article.id,
                    })
                : undefined
            }
            articles={articles}
            onOpen={(id) => open("help", id)}
          />
        ) : post ? (
          <FeedbackDetail
            key={post.id}
            post={post}
            onVote={onVoteFeedback}
            onFollow={onFollowFeedback}
            onComment={onCommentFeedback}
            onVoteComment={onVoteComment}
            drafts={draftStore}
            offline={offline}
          />
        ) : update ? (
          <>
            <UpdateDetail
              entry={update}
              posts={feedback}
              onOpenPost={(id) => open("feedback", id)}
              onReact={offline ? undefined : onReactToUpdate}
              onShare={offline ? undefined : onShareUpdate}
            />
            {update.unread && onReadUpdate && (
              <button
                type="button"
                className="qb-text-button"
                disabled={offline || readState.pending}
                onClick={() =>
                  void read.run(
                    () => onReadUpdate(update.id),
                    `updates:${update.id}`,
                  )
                }
              >
                {t("Mark update as read")}
              </button>
            )}
            {readState.error && (
              <p role="alert" className="qb-form-error">
                {readState.error}
              </p>
            )}
          </>
        ) : conversation ? (
          <ConversationView
            key={conversation.id}
            scrollContainer={nav.content}
            conversation={conversation}
            attachmentsEnabled={attachmentsEnabled === true}
            attachmentReset={attachmentReset}
            onFilesChange={(files) =>
              draftStore.changeFiles(`reply:${conversation.id}`, files)
            }
            offline={offline}
            draft={draftStore.drafts[`reply:${conversation.id}`] ?? emptyDraft}
            onChange={(body) =>
              draftStore.change(`reply:${conversation.id}`, body)
            }
            onReply={
              onReplyMessage
                ? () => {
                    if (offline) return;
                    void draftStore.submit(
                      `reply:${conversation.id}`,
                      (body, options) =>
                        onReplyMessage(conversation.id, body, options),
                      () => {},
                    );
                  }
                : undefined
            }
            onRead={
              onReadConversation
                ? () => markConversationRead(conversation.id)
                : undefined
            }
            reading={readState.pending}
            readError={readState.error}
            onOpenFile={
              onOpenFile
                ? (fileId) => onOpenFile(conversation.id, fileId)
                : undefined
            }
            onConfirmCard={
              onConfirmFeedbackCard
                ? (messageId, card) =>
                    onConfirmFeedbackCard(conversation.id, messageId, card)
                : undefined
            }
            onHandoff={
              onHandoffConversation
                ? () => onHandoffConversation(conversation.id)
                : undefined
            }
          />
        ) : selected ? (
          <p className="qb-empty">{t("This item is no longer available.")}</p>
        ) : loadState !== "ready" &&
          !articles.length &&
          !feedback.length &&
          !updates.length &&
          !conversations.length ? (
          <div className="qb-loading-placeholder" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : tab === "home" ? (
          <HomeView
            latest={updates.find((item) => item.unread) ?? updates[0]}
            navigate={navigate}
            compose={compose}
            has={has}
            openUpdate={(id) => open("updates", id)}
            conversations={conversations}
            openConversation={(id) => open("messages", id)}
            teamAvailability={teamAvailability}
            team={team}
            replyTime={replyTime}
            greeting={greeting}
            openPortal={onOpenPortal}
            changeAvatar={onChangeAvatar}
            survey={
              survey &&
              onAnswerSurvey && (
                <SurveyPrompt
                  key={survey.id}
                  survey={survey}
                  offline={offline}
                  onAnswer={(answer) => onAnswerSurvey(survey.id, answer)}
                  onDismiss={() => onDismissSurvey?.(survey.id)}
                />
              )
            }
          />
        ) : tab === "messages" ? (
          <MessagesView
            conversations={conversations}
            onOpen={(id) => open("messages", id)}
            onCompose={() => compose("message")}
            contactEmail={contactEmail}
            onRequestContactEmail={onRequestContactEmail}
            onConfirmContactEmail={onConfirmContactEmail}
            offline={offline}
          />
        ) : tab === "help" ? (
          <HelpView
            articles={articles}
            onOpen={(id) => open("help", id)}
            filters={helpFilters}
            onFilters={(filters) => {
              setHelpFilters(filters);
              nav.resetScroll();
            }}
          />
        ) : tab === "feedback" ? (
          <FeedbackView
            posts={feedback}
            identified={identified}
            onOpen={(id) => open("feedback", id)}
            onCompose={() => compose("feedback")}
            onVote={onVoteFeedback}
            offline={offline}
            filters={feedbackFilters}
            onFilters={(filters) => {
              setFeedbackFilters(filters);
              if (
                filters.query !== feedbackFilters.query ||
                filters.sort !== feedbackFilters.sort ||
                filters.status !== feedbackFilters.status
              )
                nav.resetScroll();
            }}
          />
        ) : (
          <UpdatesView
            entries={updates}
            onOpen={(id) => open("updates", id)}
            onReact={offline ? undefined : onReactToUpdate}
            onShare={offline ? undefined : onShareUpdate}
            subscribed={updatesSubscribed}
            onSubscribe={offline ? undefined : onSubscribeUpdates}
          />
        )}
      </div>
      {!composer && !selected && !route.activity && (
        <>
          <nav className="qb-nav" aria-label={t("Widget navigation")}>
            {shownTabs.map((item) => {
              const unread =
                item.id === "messages"
                  ? unreadMessages
                  : item.id === "updates"
                    ? unreadUpdates
                    : 0;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <span>
                    <Icon
                      name={item.id}
                      weight={tab === item.id ? "fill" : "regular"}
                    />
                    {unread > 0 && (
                      <i
                        className="qb-nav-unread"
                        aria-label={t("{count} unread", { count: unread })}
                      />
                    )}
                  </span>
                  {t(item.label)}
                </button>
              );
            })}
          </nav>
        </>
      )}
      {((!selected && composer !== "feedback") || !!conversation) && (
        <footer className="qb-footer">
          {t("Powered by")} <strong>Quills</strong>
        </footer>
      )}
    </section>
  );
}
