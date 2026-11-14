import { AttachmentPicker } from "../ui/attachment-picker";
import { BoardSelect } from "../ui/post/board-select";
import { CommentReactions } from "../ui/post/comment-reactions";
import { ReactionBar } from "../ui/reaction-bar";
import { ComposerDetails } from "../ui/post/composer-details";
import { FeedbackEditor } from "../ui/feedback-editor";
import { BoardNavigation } from "../ui/board-navigation";
import { PortalSheetContent } from "../ui/portal-sheet-content";
import { PortalSelectContent } from "../ui/portal-select-content";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { portalHref } from "../core/portal-href";
import type { PortalProblemKind } from "../core/types";
import { PostSort } from "../ui/post/post-sort";
import { PostComposer } from "../ui/post/post-composer";
import { SimilarPosts } from "../ui/post/similar-posts";
import { StatusIcon } from "../ui/post/status-icon";
import { ArrowUpIcon } from "../ui/arrow-up-icon";
import { PersonAvatar } from "../ui/person-avatar";
import { ShareActions } from "../ui/share-actions";
import { PortalDialogContent } from "../ui/portal-dialog-content";
import { ChangelogEntry } from "../ui/changelog-entry";
import { HelpBreadcrumb } from "../ui/help-breadcrumb";
import { HelpCenterHome } from "../ui/help-center-home";
import { PostList } from "../ui/post/post-list";
import { PostSidebar } from "../ui/post/post-sidebar";
import { PostComment } from "../ui/post/post-comment";
import { PostVoteButton } from "../ui/post/post-vote-button";
import { ConversationDetail } from "../ui/conversation/conversation-detail";
import { ConversationMessages } from "../ui/conversation/conversation-messages";
import { ConversationReplyForm } from "../ui/conversation/conversation-reply-form";
import { MarkdownContent } from "../ui/markdown-content";
import { ConfirmAction } from "../ui/confirm-action";
import { PageFrame } from "../ui/page-frame";
import { PortalForm } from "../ui/portal-form";
import { PortalGate } from "../ui/portal-gate";
import { PortalNavigation } from "../ui/portal-navigation";
import { PortalShell } from "../ui/portal-shell";
import { ResultCard } from "../ui/result-card";
import { StateView } from "../ui/state-view";
import { SurveyCard } from "../ui/survey-card";
import {
  Dialog,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetPanel,
  Button,
  Input,
  Label,
  Field,
  FieldLabel,
  Checkbox,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/upstream";

const problems: PortalProblemKind[] = [
  "authRequired",
  "noAccess",
  "notFound",
  "gone",
  "invalid",
  "conflict",
  "failed",
  "rateLimited",
];
const outcomes = {
  success: "core.gallery.success",
  failed: "core.gallery.failed",
  invalid: "core.gallery.invalid",
  rateLimited: "core.gallery.rateLimited",
} as const;

export function KitGallery() {
  const { t } = useTranslation("quills");
  const [empty, setEmpty] = useState(false);
  const [pending, setPending] = useState(false);
  const [voted, setVoted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<keyof typeof outcomes>("success");
  const demo = t("core.gallery.demo");
  const schema = z.object({
    message: z.string().min(1, t("core.gallery.required")),
  });
  return (
    <PortalShell
      navigation={
        <PortalNavigation
          workspaceId="gallery"
          currentPath={portalHref("gallery")}
        />
      }
      workspaceName={demo}
      branding={{
        logoUrl: null,
        theme: { themeMode: "user", light: {}, dark: {} },
        headerDisplayMode: "logo_and_name",
        headerDisplayName: null,
      }}
    >
      <PageFrame titleKey="core.gallery.title">
        <div className="grid gap-8">
          <section className="grid gap-4" aria-labelledby="gallery-states">
            <h2 id="gallery-states">{t("core.gallery.states")}</h2>
            <StateView loading>{null}</StateView>
            <StateView empty>{null}</StateView>
            {problems.map((kind) => (
              <StateView
                key={kind}
                problem={{
                  kind,
                  retryAt:
                    kind === "rateLimited" ? Date.now() + 10000 : undefined,
                }}
                onRetry={() => {}}
              >
                {null}
              </StateView>
            ))}
            <PortalGate
              workspaceId="gallery"
              audience="public"
              portalEnabled={false}
              accessGranted={false}
              signedIn={false}
            >
              {null}
            </PortalGate>
            <PortalGate
              workspaceId="gallery"
              audience="signed-in"
              portalEnabled
              accessGranted={false}
              signedIn={false}
            >
              {null}
            </PortalGate>
            <PortalGate
              workspaceId="gallery"
              audience="portal"
              portalEnabled
              accessGranted={false}
              signedIn
            >
              {null}
            </PortalGate>
            <PortalGate
              workspaceId="gallery"
              audience="public"
              portalEnabled
              accessGranted
              signedIn
            >
              <p>{demo}</p>
            </PortalGate>
          </section>
          <section className="grid gap-4" aria-labelledby="gallery-actions">
            <h2 id="gallery-actions">{t("core.gallery.actions")}</h2>
            <ConfirmAction
              labelKey="core.gallery.confirm"
              onConfirm={async () => {
                setConfirmed(true);
              }}
            />
            <ConfirmAction
              disabled
              labelKey="core.gallery.confirm"
              onConfirm={async () => {}}
            />
            {confirmed ? <ResultCard titleKey="core.gallery.result" /> : null}
            <ResultCard titleKey="core.gallery.result">
              <p>{demo}</p>
            </ResultCard>
            <ResultCard titleKey="core.problem.failed" status="failed" />
            <Field>
              <FieldLabel htmlFor="gallery-outcome">
                {t("core.gallery.form")}
              </FieldLabel>
              <Select
                items={Object.entries(outcomes).map(([value, label]) => ({
                  value,
                  label: t(label),
                }))}
                value={outcome}
                onValueChange={(value) => {
                  if (value) setOutcome(value as keyof typeof outcomes);
                }}
              >
                <SelectTrigger id="gallery-outcome">
                  <SelectValue />
                </SelectTrigger>
                <PortalSelectContent>
                  <SelectGroup>
                    {Object.entries(outcomes).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {t(label)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </PortalSelectContent>
              </Select>
            </Field>
            <PortalForm
              key={outcome}
              schema={schema}
              defaultValues={{ message: "" }}
              submitKey="core.gallery.confirm"
              onSubmit={async () => {
                if (outcome === "success") {
                  setConfirmed(true);
                  return;
                }
                if (outcome === "invalid")
                  return {
                    kind: "invalid",
                    issues: [
                      { path: "message", message: t("core.gallery.required") },
                    ],
                  };
                return {
                  kind: outcome,
                  retryAt:
                    outcome === "rateLimited" ? Date.now() + 5000 : undefined,
                };
              }}
            >
              {(form) => (
                <div>
                  <Label htmlFor="gallery-message">
                    {t("core.gallery.message")}
                  </Label>
                  <Input
                    id="gallery-message"
                    aria-invalid={Boolean(form.formState.errors.message)}
                    {...form.register("message")}
                  />
                  {form.formState.errors.message ? (
                    <p role="alert">
                      {String(form.formState.errors.message.message)}
                    </p>
                  ) : null}
                </div>
              )}
            </PortalForm>
          </section>
          <section className="grid gap-4" aria-labelledby="gallery-content">
            <h2 id="gallery-content">{t("core.gallery.content")}</h2>
            <Label>
              <Checkbox checked={empty} onCheckedChange={setEmpty} />
              {t("core.gallery.empty")}
            </Label>
            <Label>
              <Checkbox checked={pending} onCheckedChange={setPending} />
              {t("core.gallery.pending")}
            </Label>
            <MarkdownContent content={t("core.gallery.markdown")} />
            <BoardNavigation
              boards={
                empty ? [] : [{ id: "board_test_1", name: demo, postCount: 3 }]
              }
              workspaceId="gallery"
              stages={[{ value: "planned", label: demo, color: null }]}
              stage={pending ? "planned" : ""}
              onStageChange={() => setPending(!pending)}
            />
            <BoardSelect
              name="gallery-board"
              boards={[{ id: "board_test_1", name: demo }]}
              value={empty ? undefined : "board_test_1"}
              onChange={() => {}}
            />
            <AttachmentPicker
              attachments={empty ? [] : [{ id: "file_1", name: demo }]}
              files={[]}
              onFilesChange={() => {}}
              onRemove={() => {}}
              onRemoveFile={() => {}}
            />
            <FeedbackEditor
              id="gallery-editor"
              value={demo}
              onChange={() => {}}
              maxLength={10000}
              attachments={[]}
              files={[]}
              onFilesChange={() => {}}
              onRemove={() => {}}
              onRemoveFile={() => {}}
            />
            <Sheet>
              <SheetTrigger render={<Button />}>{demo}</SheetTrigger>
              <PortalSheetContent>
                <SheetHeader>
                  <SheetTitle>{demo}</SheetTitle>
                </SheetHeader>
                <SheetPanel>{demo}</SheetPanel>
              </PortalSheetContent>
            </Sheet>
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>
                {demo}
              </DialogTrigger>
              <PortalDialogContent>
                <DialogTitle>{demo}</DialogTitle>
              </PortalDialogContent>
            </Dialog>
            <PostSort sort="votes" onSortChange={() => {}} />
            <PostComposer
              workspaceName={demo}
              boards={[{ id: "board_test_1", name: demo }]}
              signInHref={pending ? portalHref("gallery") : undefined}
              onTitleChange={() => {}}
              onSubmit={async () => setConfirmed(true)}
            />
            <SimilarPosts
              workspaceId="gallery"
              posts={
                empty
                  ? []
                  : [
                      {
                        id: "post_test_1",
                        title: demo,
                        voteCount: 3,
                        stage: "planned",
                      },
                    ]
              }
            />
            <p className="flex items-center gap-3">
              {["open", "planned", "in_progress", "shipped", null].map(
                (stage) => (
                  <StatusIcon key={String(stage)} stage={stage} />
                ),
              )}
              <ArrowUpIcon />
              <PersonAvatar name={empty ? null : demo} />
            </p>
            <ShareActions />
            <ShareActions compact />
            <HelpBreadcrumb
              items={[{ label: demo, href: portalHref("gallery", "hc") }]}
            />
            <HelpCenterHome
              workspaceId="gallery"
              locales={["en", "fr"]}
              categories={
                empty
                  ? []
                  : [
                      {
                        id: "kb_category_test_1",
                        name: demo,
                        description: pending ? demo : null,
                        icon: null,
                        articleCount: 3,
                        path: "hc",
                        parentId: null,
                      },
                    ]
              }
              popular={[{ id: "article_test_1", title: demo, path: "hc" }]}
              searchQuery=""
            />
            <ChangelogEntry
              workspaceId="gallery"
              entry={{
                id: "changelog_test_1",
                title: demo,
                content: t("core.gallery.markdown"),
                publishedAt: "2026-01-01T00:00:00.000Z",
                author: empty ? null : { name: demo, avatarUrl: null },
                categories: empty
                  ? []
                  : [{ id: "category_test_1", name: demo }],
                linkedPosts: empty
                  ? []
                  : [
                      {
                        id: "post_test_1",
                        title: demo,
                        voteCount: 3,
                        stage: "shipped",
                      },
                    ],
                requesterCount: empty ? 0 : 3,
              }}
              linkTitle={!pending}
            />
            <PostList
              posts={[]}
              workspaceId="gallery"
              canVote={false}
              canLoadMore={false}
              loadingMore={false}
              onLoadMore={() => {}}
              onVote={async () => {}}
            />
            <PostSidebar
              author={{ name: empty ? null : demo, avatarUrl: null }}
              createdAt="2026-01-01T00:00:00.000Z"
              status={empty ? null : { name: demo, color: "currentColor" }}
              stage={empty ? null : "planned"}
              board={{ name: demo, href: portalHref("gallery") }}
              following={pending}
              signInHref={empty ? portalHref("gallery") : undefined}
              onFollowChange={async (next) => setPending(next)}
              onEdit={() => setConfirmed(true)}
              onDelete={() => setEmpty(true)}
            />
            <ComposerDetails defaultValue={empty ? "" : demo} />
            <div className="flex items-center gap-3">
              <CommentReactions
                reactions={
                  empty ? [] : [{ emoji: "🚀", count: 1, reacted: voted }]
                }
                onReact={async (_emoji, reacted) => setVoted(reacted)}
              />
            </div>
            <ReactionBar
              reactions={
                empty ? [] : [{ emoji: "🎉", count: 2, reacted: voted }]
              }
              onReact={async (_emoji, reacted) => setVoted(reacted)}
            />
            <ul>
              <PostComment
                comment={{
                  id: "comment_test_1",
                  parentId: null,
                  content: demo,
                  author: { name: demo, avatarUrl: null, isTeamMember: true },
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: pending ? "2026-01-02T00:00:00.000Z" : null,
                  deleted: empty,
                  isAuthor: true,
                  canEdit: !pending,
                  canDelete: !pending,
                  pending,
                  reactions: [{ emoji: "❤️", count: 2, reacted: voted }],
                }}
                onEdit={() => setConfirmed(true)}
                onDelete={() => setEmpty(true)}
                onReact={async (_id, _emoji, liked) => setVoted(liked)}
                replyForm={() => <p>{demo}</p>}
              />
            </ul>
            <PostVoteButton
              voted={voted}
              voteCount={voted ? 1 : 0}
              disabled={pending}
              loading={pending}
              onVote={async (next) => setVoted(next)}
            />
            <ConversationDetail
              conversation={{
                subject: empty ? null : demo,
                status: pending ? "closed" : "open",
                isReadOnly: pending,
              }}
              teamTyping={pending}
            />
            <ConversationMessages
              messages={
                empty
                  ? []
                  : [
                      {
                        id: "message_test_1",
                        fromVisitor: true,
                        senderType: "customer",
                        author: null,
                        content: demo,
                        attachments: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                      },
                      {
                        id: "message_test_2",
                        fromVisitor: false,
                        senderType: "system",
                        author: null,
                        content: demo,
                        attachments: [{ name: "example.txt" }],
                        createdAt: "2026-01-01T00:00:00.000Z",
                      },
                      {
                        id: "message_test_3",
                        fromVisitor: false,
                        senderType: "user",
                        author: { name: demo },
                        content: demo,
                        attachments: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                      },
                    ]
              }
            />
            <ConversationReplyForm
              onSubmit={async () => {
                setConfirmed(true);
              }}
            />
            {/* RFC 0003 lane L2: in-app surveys. */}
            <SurveyCard
              survey={{
                type: "nps",
                question: demo,
                options: [],
                scale: { min: 0, max: 10 },
              }}
              done={confirmed}
              onSubmit={async () => {
                setConfirmed(true);
              }}
              onDismiss={() => setEmpty(true)}
            />
          </section>
        </div>
      </PageFrame>
    </PortalShell>
  );
}
