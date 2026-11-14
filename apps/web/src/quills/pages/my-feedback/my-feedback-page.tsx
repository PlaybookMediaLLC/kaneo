import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useListPortalMyFeedback } from "../../hooks/feedback/use-list-portal-my-feedback";
import { useGetMyWeeklyDigestPreference } from "../../hooks/portal/use-get-my-weekly-digest-preference";
import { useSetMyWeeklyDigestPreference } from "../../hooks/portal/use-set-my-weekly-digest-preference";
import { usePortalRuntime } from "../../portal/runtime";
import { ConfirmAction } from "../../ui/confirm-action";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";
import {
  FeedbackFilter,
  type FeedbackFilterValue,
} from "./parts/feedback-filter";
import { MyFeedbackRow } from "./parts/my-feedback-row";

export interface MyFeedbackPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** The signed-in customer's posts, votes and follows, and the weekly digest switch (RFC 0003, feature 16). */
export function MyFeedbackPage(props: MyFeedbackPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const [filter, setFilter] = useState<FeedbackFilterValue>("all");
  const workspace =
    !portal.accessLoading &&
    portal.access?.granted &&
    portal.viewer.kind === "user"
      ? props.workspaceId
      : "";
  const list = useListPortalMyFeedback(
    // The route prefetches the "all" page with the same query.
    { param: { workspace }, query: { filter, offset: "0", limit: "20" } },
    portal.viewer,
  );
  const digest = useGetMyWeeklyDigestPreference(
    { param: { workspace } },
    portal.viewer,
  );
  const setDigest = useSetMyWeeklyDigestPreference(portal.viewer);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const weeklyDigest = digest.data?.weeklyDigest;

  return (
    <PageFrame
      titleKey="my-feedback.title"
      description={t("my-feedback.description")}
      token="none"
      tokenScope={undefined}
      persistToken
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "my-feedback")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={list.isLoading || digest.isLoading}
            problem={list.error ?? digest.error ?? null}
            onRetry={() => {
              void list.refetch();
              void digest.refetch();
            }}
          >
            {weeklyDigest !== undefined ? (
              <div className="rounded-xl border border-border p-4">
                <ConfirmAction
                  labelKey="my-feedback.digest"
                  role="switch"
                  aria-checked={weeklyDigest}
                  disabled={setDigest.isPending}
                  onConfirm={async () => {
                    await setDigest.mutateAsync({
                      param: { workspace: props.workspaceId },
                      json: { weeklyDigest: !weeklyDigest },
                    });
                  }}
                />
              </div>
            ) : null}
            <FeedbackFilter value={filter} onChange={setFilter} />
            {items.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {items.map((item) => (
                  <MyFeedbackRow
                    key={item.id}
                    workspaceId={props.workspaceId}
                    item={item}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("core.empty")}</p>
            )}
            {list.hasNextPage ? (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => list.fetchNextPage()}
                loading={list.isFetchingNextPage}
              >
                {t("my-feedback.loadMore")}
              </Button>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
