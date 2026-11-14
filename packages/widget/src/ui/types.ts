export type WidgetTab = "home" | "messages" | "help" | "feedback" | "updates";
export type FeedbackStatus = "open" | "planned" | "in_progress" | "shipped";
export interface SubmissionOptions {
  idempotencyKey: string;
  attachments?: readonly File[];
  /** Article that prompted a new conversation; the server must verify access. */
  articleId?: string;
}
export interface WidgetPerson {
  name: string;
  avatarUrl?: string;
  verified?: boolean;
}
export interface Attachment {
  id: string;
  name: string;
  url: string;
}
export interface FeedbackComment {
  id: string;
  body: string;
  author: string;
  avatarUrl?: string;
  verified?: boolean;
  createdAt?: string;
  parentId?: string;
  votes: number;
  voted?: boolean;
}
export interface HelpFilters {
  query: string;
  category: string | null;
}
export interface FeedbackFilters {
  query: string;
  sort: string;
  status: FeedbackStatus | "all";
  roadmapExpanded?: readonly FeedbackStatus[];
}
export type ArticleBlock =
  | { type: "paragraph" | "heading" | "code"; text: string }
  | { type: "list"; items: readonly string[]; ordered?: boolean };

export interface FeedbackPost {
  id: string;
  title: string;
  body: string;
  author: string;
  /** Missing when the board hides vote counts. */
  votes?: number;
  voted?: boolean;
  following?: boolean;
  status?: FeedbackStatus;
  createdAt?: string;
  avatarUrl?: string;
  verified?: boolean;
  voters?: readonly WidgetPerson[];
  comments?: readonly FeedbackComment[];
  attachments?: readonly Attachment[];
}

export interface HelpArticle {
  id: string;
  category: string;
  title: string;
  body: string;
  blocks?: readonly ArticleBlock[];
  author?: WidgetPerson;
  updatedAt?: string;
  url?: string;
  helpful?: boolean;
}

export interface RequestActivity {
  id: string;
  postId: string;
  title: string;
  kind: "reply" | "status" | "shipped";
  summary: string;
  createdAt: string;
  unread: boolean;
}

export interface UpdateEntry {
  id: string;
  title: string;
  body: string;
  date: string;
  author: string;
  authorRole?: string;
  avatarUrl?: string;
  blocks?: readonly ArticleBlock[];
  relatedPostIds?: readonly string[];
  requesterCount?: number;
  unread?: boolean;
  reactions?: ReadonlyArray<{
    emoji: string;
    count: number;
    reacted?: boolean;
  }>;
}

export interface Conversation {
  id: string;
  title: string;
  unreadCount?: number;
  articleId?: string;
  messages: ReadonlyArray<{
    id: string;
    body: string;
    author: string;
    sentAt?: string;
    fromVisitor?: boolean;
    attachments?: readonly Attachment[];
  }>;
}

/** A survey that waits for the visitor (RFC 0003). `scale` is null for pmf, poll and open. */
export interface WidgetSurvey {
  id: string;
  type: "nps" | "csat" | "ces" | "pmf" | "poll" | "open";
  question: string;
  options: readonly string[];
  scale: { min: number; max: number } | null;
  /** The visitor answered it in this session: the prompt shows its thanks state. */
  answered?: boolean;
}
/** A score, a choice or only a comment, as the survey type asks. */
export interface SurveyAnswer {
  score?: number;
  choice?: string;
  comment?: string;
}

/** Data is supplied by the embedding application; this view performs no network requests. */
export interface WidgetViewProps {
  brandName?: string;
  theme?: "light" | "dark" | "auto";
  initialTab?: WidgetTab;
  feedback?: readonly FeedbackPost[];
  articles?: readonly HelpArticle[];
  updates?: readonly UpdateEntry[];
  conversations?: readonly Conversation[];
  activities?: readonly RequestActivity[];
  onReadActivity?: (id: string) => Promise<unknown>;
  onArticleFeedback?: (articleId: string, helpful: boolean) => Promise<unknown>;
  /** The host owns loading and connectivity; offline disables mutations, not reading. */
  loadState?: "ready" | "loading" | "error";
  connection?: "online" | "offline" | "reconnecting";
  onRetryLoad?: () => Promise<unknown>;
  /** Display only availability verified by the host; omit when unknown. */
  teamAvailability?: string;
  teamMember?: WidgetPerson;
  /** The host resizes its container or sends the existing quackback:expand message. */
  onExpandedChange?: (expanded: boolean) => void;
  /** A detail opened; the host can load what its list leaves out (comments, article text). */
  onOpenItem?: (tab: WidgetTab, id: string) => void;
  /** Each new object moves the mounted view, for example to a host deep link. */
  navigation?: {
    tab: WidgetTab;
    detail?: string;
    composer?: "message" | "feedback";
  };
  /**
   * Opt in only when submission callbacks process SubmissionOptions.attachments. "feedback" turns
   * attachments and the screenshot action on for the feedback composer only.
   */
  attachmentsEnabled?: boolean | "feedback";
  onCaptureScreenshot?: (signal: AbortSignal) => Promise<File | null>;
  onCommentFeedback?: (
    postId: string,
    body: string,
    options: SubmissionOptions & { parentId?: string },
  ) => Promise<unknown>;
  onVoteComment?: (
    postId: string,
    commentId: string,
    voted: boolean,
  ) => Promise<unknown>;
  onReplyMessage?: (
    conversationId: string,
    body: string,
    options: SubmissionOptions,
  ) => Promise<unknown>;
  onReadConversation?: (
    conversationId: string,
    throughMessageId: string,
  ) => Promise<unknown>;
  onReadUpdate?: (entryId: string) => Promise<unknown>;
  onVoteFeedback?: (postId: string, voted: boolean) => Promise<unknown>;
  onFollowFeedback?: (postId: string, following: boolean) => Promise<unknown>;
  onClose: () => void;
  /** Resolve only after the action succeeds. Rejections keep the draft and show an error. */
  onSendMessage?: (
    body: string,
    options: SubmissionOptions,
  ) => Promise<unknown>;
  onSubmitFeedback?: (
    body: string,
    options: SubmissionOptions,
  ) => Promise<unknown>;
  onReactToUpdate?: (entryId: string, emoji: string) => Promise<unknown>;
  onShareUpdate?: (entry: UpdateEntry) => Promise<unknown>;
  /** The survey that waits for the visitor; the home tab shows it. */
  survey?: WidgetSurvey | null;
  /** Resolve only after the API saved the answer. */
  onAnswerSurvey?: (surveyId: string, answer: SurveyAnswer) => Promise<unknown>;
  /** Hides the survey for this session. */
  onDismissSurvey?: (surveyId: string) => void;
}
