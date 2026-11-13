import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useCreatePortalPost } from "../../hooks/feedback/use-create-portal-post";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { useListPortalPosts } from "../../hooks/feedback/use-list-portal-posts";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../ui/upstream";
import { meta } from "./meta";
import { BoardList } from "./parts/board-list";
import { RecentPostList } from "./parts/recent-post-list";
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
  const posts = useListPortalPosts(
    {
      param: { workspace: canLoad ? props.workspaceId : "" },
      query: { sort: "newest", limit: "10" },
    },
    portal.viewer,
  );
  const create = useCreatePortalPost(portal.viewer);
  const postItems = posts.data?.pages.flatMap((page) => page.items) ?? [];

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
            loading={boards.isLoading || posts.isLoading}
            problem={boards.error ?? posts.error ?? null}
            onRetry={() => {
              void boards.refetch();
              void posts.refetch();
            }}
          >
            {boards.data ? (
              <>
                <BoardList
                  boards={boards.data.items}
                  workspaceId={props.workspaceId}
                />
                <RecentPostList
                  posts={postItems}
                  workspaceId={props.workspaceId}
                />
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
                  <p>
                    {t("feedback.signInToSubmit")}{" "}
                    <a
                      href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId))}`}
                    >
                      {t("feedback.signIn")}
                    </a>
                  </p>
                )}
                <Sheet open={submitting} onOpenChange={setSubmitting}>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>{t("feedback.submitTitle")}</SheetTitle>
                    </SheetHeader>
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
                  </SheetContent>
                </Sheet>
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
