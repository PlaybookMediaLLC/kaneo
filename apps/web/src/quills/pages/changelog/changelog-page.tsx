import { useTranslation } from "react-i18next";
import { changelogFeedUrl } from "../../core/changelog-feed-url";
import { portalHref } from "../../core/portal-href";
import { useListPortalChangelog } from "../../hooks/changelog/use-list-portal-changelog";
import type { SetPortalChangelogReactionRequest } from "../../api/changelog/set-portal-changelog-reaction";
import { useSetPortalChangelogReaction } from "../../hooks/changelog/use-set-portal-changelog-reaction";
import { useListPortalVotedPosts } from "../../hooks/feedback/use-list-portal-voted-posts";
import { usePortalRuntime } from "../../portal/runtime";
import { ChangelogEntry } from "../../ui/changelog-entry";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { ReactionBar } from "../../ui/reaction-bar";
import { ShareActions } from "../../ui/share-actions";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";

type Emoji = SetPortalChangelogReactionRequest["json"]["emoji"];

export interface ChangelogPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function ChangelogPage(props: ChangelogPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const gated = (meta.audience as string) !== "public";
  const canLoad = !gated || portal.access?.granted === true;
  const changelog = useListPortalChangelog(
    {
      param: { workspace: canLoad ? props.workspaceId : "" },
      query: { offset: "0", limit: "20" },
    },
    viewer,
  );
  const entries = changelog.data?.pages.flatMap((page) => page.entries) ?? [];
  // Only a signed-in viewer has votes, and only linked requests need the marks.
  const voted = useListPortalVotedPosts(
    {
      param: {
        workspace:
          viewer.kind === "user" &&
          entries.some((entry) => entry.linkedPosts.length)
            ? props.workspaceId
            : "",
      },
    },
    viewer,
  );
  const votedIds = new Set(voted.data?.postIds);
  const reaction = useSetPortalChangelogReaction(viewer);
  // Only a signed-in customer reacts; a visitor sees the counts.
  const react =
    viewer.kind === "user"
      ? (entryId: string) => async (emoji: string, reacted: boolean) => {
          await reaction.mutateAsync({
            param: { workspace: props.workspaceId, entryId },
            json: { emoji: emoji as Emoji, reacted },
          });
        }
      : undefined;

  return (
    <PageFrame
      titleKey="changelog.title"
      description={t("changelog.description")}
      wide
      actions={
        <>
          <ShareActions compact />
          <a
            className="rounded-full bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/70"
            href={changelogFeedUrl(props.workspaceId)}
          >
            {t("changelog.rss")}
          </a>
          <a
            className="rounded-full bg-muted px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/70"
            href={portalHref(props.workspaceId, "preferences")}
          >
            {t("changelog.emailUpdates")}
          </a>
        </>
      }
    >
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "changelog")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={changelog.isLoading}
            empty={changelog.isSuccess && entries.length === 0}
            problem={changelog.error ?? null}
            onRetry={() => {
              void changelog.refetch();
            }}
          >
            <div className="portal-updates pt-2">
              {entries.map((entry) => (
                <ChangelogEntry
                  key={entry.id}
                  workspaceId={props.workspaceId}
                  entry={entry}
                  votedIds={votedIds}
                >
                  <ReactionBar
                    reactions={entry.reactions}
                    onReact={react?.(entry.id)}
                  />
                </ChangelogEntry>
              ))}
              {changelog.hasNextPage ? (
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => changelog.fetchNextPage()}
                  loading={changelog.isFetchingNextPage}
                >
                  {t("changelog.loadMore")}
                </Button>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  {t("changelog.caughtUp")}
                </p>
              )}
            </div>
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
