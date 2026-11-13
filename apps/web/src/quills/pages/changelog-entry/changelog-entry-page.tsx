import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPortalChangelogEntry } from "../../hooks/changelog/use-get-portal-changelog-entry";
import { usePortalRuntime } from "../../portal/runtime";
import { ChangelogEntry } from "../../ui/changelog-entry";
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
  const { t } = useTranslation("quills");
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
    <PageFrame
      titleKey="changelog.entryTitle"
      displayTitle={canLoad ? entry.data?.title : undefined}
      wide
    >
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
              <>
                <a
                  className="text-sm text-muted-foreground hover:text-foreground"
                  href={portalHref(props.workspaceId, "changelog")}
                >
                  {t("changelog.back")}
                </a>
                <ChangelogEntry
                  workspaceId={props.workspaceId}
                  entry={entry.data}
                  linkTitle={false}
                />
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
