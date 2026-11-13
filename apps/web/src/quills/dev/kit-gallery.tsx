import { FeedbackEditor } from "../ui/feedback-editor";
import { HelpNavigation } from "../ui/help-navigation";
import { BoardNavigation } from "../ui/board-navigation";
import { PortalSheetContent } from "../ui/portal-sheet-content";
import { PortalSelectContent } from "../ui/portal-select-content";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { portalHref } from "../core/portal-href";
import type { PortalProblemKind } from "../core/types";
import { PostFilters } from "../ui/post/post-filters";
import { PostList } from "../ui/post/post-list";
import { PostDetail } from "../ui/post/post-detail";
import { PostComments } from "../ui/post/post-comments";
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
import {
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
            <HelpNavigation workspaceId="gallery" categories={[]} />
            <BoardNavigation boards={[]} workspaceId="gallery" />
            <Sheet>
              <SheetTrigger render={<Button />}>{demo}</SheetTrigger>
              <PortalSheetContent>
                <SheetHeader>
                  <SheetTitle>{demo}</SheetTitle>
                </SheetHeader>
                <SheetPanel>{demo}</SheetPanel>
              </PortalSheetContent>
            </Sheet>
            <PostFilters
              search=""
              stage=""
              sort="newest"
              stages={[]}
              onSearchChange={() => {}}
              onStageChange={() => {}}
              onSortChange={() => {}}
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
            <PostDetail
              post={{
                title: demo,
                content: demo,
                author: { name: empty ? null : demo },
                board: { name: demo },
                status: empty ? null : { name: demo },
                pending,
                mergedInto: pending ? { title: demo } : null,
              }}
            />
            <PostComments
              comments={
                empty
                  ? []
                  : [
                      {
                        id: "comment_test_1",
                        content: demo,
                        author: { name: demo },
                        createdAt: "2026-01-01T00:00:00.000Z",
                        deleted: false,
                        isAuthor: true,
                        canEdit: !pending,
                        canDelete: !pending,
                        pending,
                        updatedAt: pending ? "2026-01-02T00:00:00.000Z" : null,
                      },
                      {
                        id: "comment_test_2",
                        content: demo,
                        author: { name: null },
                        createdAt: "2026-01-01T00:00:00.000Z",
                        deleted: true,
                        isAuthor: false,
                        canEdit: false,
                        canDelete: false,
                        pending: false,
                        updatedAt: null,
                      },
                    ]
              }
              onEdit={() => setConfirmed(true)}
              onDelete={() => setEmpty(true)}
            />
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
          </section>
        </div>
      </PageFrame>
    </PortalShell>
  );
}
