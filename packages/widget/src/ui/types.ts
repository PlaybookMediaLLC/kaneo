export type WidgetTab = "home" | "messages" | "help" | "feedback" | "updates";
export type FeedbackStatus = "open" | "planned" | "in_progress" | "shipped";
export interface SubmissionOptions {
  idempotencyKey: string;
  attachments?: readonly File[];
  /** Article that prompted a new conversation; the server must verify access. */
  articleId?: string;
  /** Feedback: the title and board that the visitor confirmed from a draft; the server checks the board. */
  title?: string;
  boardId?: string;
  /** Feedback: the board's custom field values, typed and without empty ones. */
  customFields?: Record<string, string | number | boolean | string[]>;
}
/** A public custom field that a board asks for (issue #71). */
export interface FeedbackField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "multi_select" | "checkbox" | "date";
  required: boolean;
  options?: readonly string[];
}
/** A suggested title and board for the visitor's feedback, with similar requests. Nothing is saved. */
export interface FeedbackDraft {
  title: string;
  /** Omitted when no board was suggested: the post goes to the default board. */
  board?: { id: string; name: string; fields?: readonly FeedbackField[] };
  similar: ReadonlyArray<{
    id: string;
    title: string;
    votes?: number;
    voted?: boolean;
  }>;
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

/** A request like the visitor's draft, from anywhere on the board. */
export interface SimilarRequest {
  id: string;
  title: string;
  votes?: number;
  voted?: boolean;
}

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

/** An anonymous visitor's contact address and a change that waits for its code. */
export interface ContactEmail {
  email: string | null;
  pendingEmail: string | null;
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
  /** ISO time; with it the view shows the date in the widget's language instead of `date`. */
  publishedAt?: string;
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

export interface MessageCitation {
  title: string;
  url: string;
  sourceType: "article" | "web";
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
    /** Files a teammate sent: each downloads through onOpenFile. */
    files?: ReadonlyArray<{ id: string; name: string }>;
    /** The workspace's assistant wrote it. */
    fromAssistant?: boolean;
    /** Grounded sources cited by the assistant reply (#299). */
    citations?: readonly MessageCitation[];
    /** A request the assistant proposed; the visitor submits it once. */
    feedbackCard?: { title: string; body: string; confirmed: boolean };
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
  /** Text direction of the panel; "rtl" for a right-to-left language. Default "ltr". */
  dir?: "ltr" | "rtl";
  /** The host app identified the visitor (a signed token): the roadmap marks what they voted for. */
  identified?: boolean;
  theme?: "light" | "dark" | "auto";
  /** A BCP-47 tag for the widget's language; unsupported tags show English. */
  locale?: string;
  initialTab?: WidgetTab;
  /** The tabs that the workspace turned on; omit for all. A route to another tab shows the first of these. */
  tabs?: readonly WidgetTab[];
  feedback?: readonly FeedbackPost[];
  articles?: readonly HelpArticle[];
  updates?: readonly UpdateEntry[];
  conversations?: readonly Conversation[];
  activities?: readonly RequestActivity[];
  /** Anonymous visitors only: the "Get replies by email" card in Messages. */
  contactEmail?: ContactEmail;
  /** Mails a code to the address; resolves after the API accepts it. */
  onRequestContactEmail?: (email: string) => Promise<unknown>;
  /** Sets the address with its code; rejects on a wrong code. */
  onConfirmContactEmail?: (email: string, code: string) => Promise<unknown>;
  onReadActivity?: (id: string) => Promise<unknown>;
  onArticleFeedback?: (articleId: string, helpful: boolean) => Promise<unknown>;
  onSearchHelp?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<{ queryId: string | null; articles: HelpArticle[] }>;
  onSearchHelpClick?: (queryId: string, articleId: string) => void;
  /** The host owns loading and connectivity; offline disables mutations, not reading. */
  loadState?: "ready" | "loading" | "error";
  connection?: "online" | "offline" | "reconnecting";
  onRetryLoad?: () => Promise<unknown>;
  /** Display only availability verified by the host; omit when unknown. */
  teamAvailability?: string;
  /** The team's live availability and up to four teammate avatars, from the API. */
  team?: {
    online: boolean;
    avatars: readonly WidgetPerson[];
    withinOfficeHours?: boolean;
    waitEstimateLabel?: string | null;
    nextOpenAt?: string | null;
  };
  /** How soon the team usually replies, as a teammate set it. */
  replyTime?: "minutes" | "hours" | "day";
  /** Home's greeting and subtitle from the workspace; null keeps the default. */
  greeting?: { title: string | null; subtitle: string | null };
  /**
   * Opens the portal for the identified visitor. Resolves "opened" when a new tab signs them in,
   * "sent" when a sign-in link is on its way to their email, or "if_account" when only an address
   * with an account gets it. Omit to hide the action.
   */
  onOpenPortal?: () => Promise<"opened" | "sent" | "if_account">;
  /**
   * Saves (a file) or removes (null) the identified visitor's picture and resolves its new URL.
   * Omit to hide Home's picture row.
   */
  onChangeAvatar?: (file: File | null) => Promise<string | null>;
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
    /** Text for an empty composer; a draft the visitor already typed stays. */
    draft?: string;
    /** Help search text. */
    query?: string;
    /** A help category to show, by name. */
    category?: string;
    /** The activity page. */
    activity?: boolean;
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
  /** Posts the request the assistant proposed in a message, and marks the card submitted. */
  onConfirmFeedbackCard?: (
    conversationId: string,
    messageId: string,
    card: { title: string; body: string },
  ) => Promise<unknown>;
  /** Immediately connects the visitor with a human teammate (zero LLM call, #299). */
  onHandoffConversation?: (conversationId: string) => Promise<unknown>;
  onReadConversation?: (
    conversationId: string,
    throughMessageId: string,
  ) => Promise<unknown>;
  /** Resolves with a short-lived download URL of a file in a conversation. */
  onOpenFile?: (conversationId: string, fileId: string) => Promise<string>;
  onReadUpdate?: (entryId: string) => Promise<unknown>;
  /** Whether the identified visitor hears about new updates; with it, the Updates tab offers a toggle. */
  updatesSubscribed?: boolean;
  /** Resolve only after the API saved the choice. */
  onSubscribeUpdates?: (subscribed: boolean) => Promise<unknown>;
  onVoteFeedback?: (postId: string, voted: boolean) => Promise<unknown>;
  /** Requests on the whole board with a title like the text; the loaded posts are used without it. */
  onFindSimilar?: (
    text: string,
    signal: AbortSignal,
  ) => Promise<readonly SimilarRequest[]>;
  onFollowFeedback?: (postId: string, following: boolean) => Promise<unknown>;
  onClose: () => void;
  /** False hides the close button: the widget is inline in the host page. */
  closable?: boolean;
  /** Resolve only after the action succeeds. Rejections keep the draft and show an error. */
  onSendMessage?: (
    body: string,
    options: SubmissionOptions,
  ) => Promise<unknown>;
  onSubmitFeedback?: (
    body: string,
    options: SubmissionOptions,
  ) => Promise<unknown>;
  /** Suggests a title and a board from the visitor's words; omit it when AI is off. */
  onDraftFeedback?: (body: string) => Promise<FeedbackDraft>;
  /** The public custom fields of the board that a new feedback post goes to. */
  feedbackFields?: readonly FeedbackField[];
  onReactToUpdate?: (entryId: string, emoji: string) => Promise<unknown>;
  onShareUpdate?: (entry: UpdateEntry) => Promise<unknown>;
  /** The survey that waits for the visitor; the home tab shows it. */
  survey?: WidgetSurvey | null;
  /** Resolve only after the API saved the answer. */
  onAnswerSurvey?: (surveyId: string, answer: SurveyAnswer) => Promise<unknown>;
  /** Hides the survey for this session. */
  onDismissSurvey?: (surveyId: string) => void;
}
