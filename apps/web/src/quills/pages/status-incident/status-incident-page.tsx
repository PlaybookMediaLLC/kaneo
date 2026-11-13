import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useGetPublicStatusIncident } from "../../hooks/status/use-get-public-status-incident";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
export interface StatusIncidentPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function StatusIncidentPage(props: StatusIncidentPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const incident = useGetPublicStatusIncident(
    {
      param: {
        workspace: props.workspaceId,
        incidentId: props.params.incidentId ?? "",
      },
    },
    portal.viewer,
  );

  return (
    <PageFrame
      titleKey="status-incident.title"
      displayTitle={incident.data?.title}
      token="none"
      tokenScope={undefined}
      persistToken={false}
    >
      <StateView loading={false} problem={null}>
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(
            props.workspaceId,
            `status/incidents/${props.params.incidentId ?? ""}`,
          )}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={incident.isLoading}
            problem={incident.error ?? null}
            onRetry={() => {
              void incident.refetch();
            }}
          >
            {incident.data ? (
              <article className="space-y-6 [&_section]:space-y-4 [&_ol]:space-y-6 [&_ol>li]:space-y-2 [&_ol>li]:border-l [&_ol>li]:border-border [&_ol>li]:pl-5">
                <p>
                  {t("status-incident.status", {
                    status: incident.data.status,
                  })}
                </p>
                <p>
                  {t("status-incident.impact", {
                    impact: incident.data.impact,
                  })}
                </p>
                <p>
                  {t(
                    incident.data.scheduledStartAt
                      ? "status-incident.scheduled"
                      : "status-incident.started",
                    {
                      date: new Date(
                        incident.data.scheduledStartAt ??
                          incident.data.startedAt,
                      ).toLocaleString(),
                    },
                  )}
                </p>
                <section aria-labelledby="affected-components-heading">
                  <h3 id="affected-components-heading">
                    {t("status-incident.affectedComponents")}
                  </h3>
                  {incident.data.affectedComponents.length ? (
                    <ul>
                      {incident.data.affectedComponents.map((component) => (
                        <li key={component.id}>
                          {t("status-incident.componentStatus", {
                            name: component.name,
                            status: component.componentStatus,
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("status-incident.noAffectedComponents")}</p>
                  )}
                </section>
                <section aria-labelledby="incident-updates-heading">
                  <h3 id="incident-updates-heading">
                    {t("status-incident.updates")}
                  </h3>
                  {incident.data.updates.length ? (
                    <ol>
                      {incident.data.updates.map((update) => (
                        <li key={update.id}>
                          <p>
                            {t("status-incident.status", {
                              status: update.status,
                            })}
                          </p>
                          <p>{update.body}</p>
                          <time dateTime={update.createdAt}>
                            {new Date(update.createdAt).toLocaleString()}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>{t("status-incident.noUpdates")}</p>
                  )}
                </section>
              </article>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
