import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPortalChangelogEntry } from "../../hooks/changelog/use-get-portal-changelog-entry";
import { usePortalRuntime } from "../../portal/runtime";
import { MarkdownContent } from "../../ui/markdown-content";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";

export interface ChangelogEntryPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function ChangelogEntryPage(props: ChangelogEntryPageProps) {
  const { t, i18n } = useTranslation("quills");
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const gated = (meta.audience as string) !== "public";
  const canLoad = !gated || portal.access?.granted === true;
  const entry = useGetPortalChangelogEntry(
    {
      param: {
        workspace: canLoad ? props.workspaceId : "",
        entryId: props.params.entryId ?? "",
      },
    },
    viewer,
  );

  return (
    <PageFrame titleKey="changelog.entryTitle">
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(
            props.workspaceId,
            `changelog/${props.params.entryId}`,
          )}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={entry.isLoading}
            problem={entry.error ?? null}
            onRetry={() => {
              void entry.refetch();
            }}
          >
            {entry.data ? (
              <article className="space-y-6">
                <header className="space-y-2">
                  <h2 className="text-xl font-semibold">{entry.data.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("changelog.published", {
                      date: new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: "long",
                      }).format(new Date(entry.data.publishedAt)),
                    })}
                  </p>
                </header>
                <MarkdownContent content={entry.data.content} />
                {entry.data.author ? (
                  <p>
                    {t("changelog.author", { name: entry.data.author.name })}
                  </p>
                ) : null}
                {entry.data.requesterCount > 0 ? (
                  <p>
                    {t("changelog.requesters", {
                      count: entry.data.requesterCount,
                    })}
                  </p>
                ) : null}
                {entry.data.linkedPosts.length ? (
                  <ul className="space-y-2">
                    {entry.data.linkedPosts.map((post) => (
                      <li key={post.id}>
                        <a
                          href={portalHref(
                            props.workspaceId,
                            `posts/${post.id}`,
                          )}
                          className="underline-offset-4 hover:underline"
                        >
                          {t("changelog.linkedPost", { title: post.title })}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
