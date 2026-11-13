import { PortalSheetContent } from "../../ui/portal-sheet-content";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useCreatePortalPost } from "../../hooks/feedback/use-create-portal-post";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import {
  Button,
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "../../ui/upstream";
import { meta } from "./meta";
import { BoardNavigation } from "../../ui/board-navigation";
import { HomeFeed } from "./parts/home-feed";
import { SubmitPostForm } from "./parts/submit-post-form";

export interface FeedbackHomePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function FeedbackHomePage(props: FeedbackHomePageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const [submitting, setSubmitting] = useState(false);
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const boards = useListPortalBoards(
    {
      param: { workspace: canLoad ? props.workspaceId : "" },
      query: { counts: "true" },
    },
    portal.viewer,
  );
  const create = useCreatePortalPost(portal.viewer);

  return (
    <PageFrame
      titleKey="feedback.title"
      token="none"
      tokenScope={undefined}
      persistToken={false}
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={boards.isLoading}
            problem={boards.error ?? null}
            onRetry={() => {
              void boards.refetch();
            }}
          >
            {boards.data ? (
              <div className="portal-feedback-layout grid items-start gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:gap-12">
                <BoardNavigation
                  boards={boards.data.items}
                  workspaceId={props.workspaceId}
                />
                <div className="portal-feedback-main flex min-w-0 flex-col gap-7">
                  <div className="portal-feedback-composer flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-xs [&>p]:text-muted-foreground [&_a]:inline-flex [&_a]:rounded-full [&_a]:bg-primary [&_a]:px-4 [&_a]:py-2 [&_a]:text-primary-foreground">
                    <p>{t("feedback.prompt")}</p>
                    {portal.viewer.kind === "user" ? (
                      <Button
                        type="button"
                        onClick={() => setSubmitting(true)}
                        disabled={
                          !boards.data.items.some((board) => board.canSubmit)
                        }
                      >
                        {t("feedback.submit")}
                      </Button>
                    ) : (
                      <div>
                        <a
                          href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId))}`}
                        >
                          {t("feedback.signIn")}
                        </a>
                      </div>
                    )}
                  </div>
                  <HomeFeed
                    viewer={portal.viewer}
                    boards={boards.data.items}
                    workspaceId={props.workspaceId}
                  />
                  <Sheet open={submitting} onOpenChange={setSubmitting}>
                    <PortalSheetContent>
                      <SheetHeader>
                        <SheetTitle>{t("feedback.submitTitle")}</SheetTitle>
                      </SheetHeader>
                      <SheetPanel>
                        <SubmitPostForm
                          workspaceId={props.workspaceId}
                          viewer={portal.viewer}
                          boards={boards.data.items.filter(
                            (board) => board.canSubmit,
                          )}
                          onSubmit={async (values) => {
                            try {
                              await create.mutateAsync({
                                param: { workspace: props.workspaceId },
                                json: values,
                              });
                              setSubmitting(false);
                            } catch (problem) {
                              return problem as never;
                            }
                          }}
                        />
                      </SheetPanel>
                    </PortalSheetContent>
                  </Sheet>
                </div>
              </div>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
