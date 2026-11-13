import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useListPortalChangelog } from "../../hooks/changelog/use-list-portal-changelog";
import { usePortalRuntime } from "../../portal/runtime";
import { MarkdownContent } from "../../ui/markdown-content";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";

export interface ChangelogPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function ChangelogPage(props: ChangelogPageProps) {
  const { t, i18n } = useTranslation("quills");
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

  return (
    <PageFrame titleKey="changelog.title">
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
            <div className="portal-updates space-y-12">
              {entries.map((entry) => (
                <article
                  key={entry.id}
                  className="portal-update grid gap-5 border-b border-border pb-12 md:grid-cols-[180px_minmax(0,1fr)] md:gap-12"
                >
                  <p className="text-sm text-muted-foreground">
                    {t("changelog.published", {
                      date: new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "long",
                      }).format(new Date(entry.publishedAt)),
                    })}
                  </p>
                  <div className="min-w-0 space-y-5">
                    <h2 className="text-xl font-semibold">
                      <a
                        href={portalHref(
                          props.workspaceId,
                          `changelog/${entry.id}`,
                        )}
                        className="underline-offset-4 hover:underline"
                      >
                        {entry.title}
                      </a>
                    </h2>
                    <MarkdownContent content={entry.content} />
                    {entry.author ? (
                      <p className="text-sm">
                        {t("changelog.author", { name: entry.author.name })}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
              {changelog.hasNextPage ? (
                <Button
                  onClick={() => changelog.fetchNextPage()}
                  disabled={changelog.isFetchingNextPage}
                >
                  {t("changelog.loadMore")}
                </Button>
              ) : null}
            </div>
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
