import { useTranslation } from "react-i18next";
import type { GetPublicStatusPageResponse } from "../../../api/status/get-public-status-page";
import type { GetPublicStatusUptimeResponse } from "../../../api/status/get-public-status-uptime";
import type { ListPublicStatusHistoryResponse } from "../../../api/status/list-public-status-history";
import { portalHref } from "../../../core/portal-href";
import { Button } from "../../../ui/upstream";

export interface StatusContentProps {
  workspaceId: string;
  page: GetPublicStatusPageResponse;
  uptime: GetPublicStatusUptimeResponse | undefined;
  incidents: ListPublicStatusHistoryResponse["items"];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function StatusContent(props: StatusContentProps) {
  const { t } = useTranslation("quills");
  const statusLabels = {
    operational: t("status.status.operational"),
    under_maintenance: t("status.status.under_maintenance"),
    degraded_performance: t("status.status.degraded_performance"),
    partial_outage: t("status.status.partial_outage"),
    major_outage: t("status.status.major_outage"),
  };
  const components = [
    ...props.page.groups.flatMap((group) => group.components),
    ...props.page.ungroupedComponents,
  ];
  const incidentLink = (id: string) =>
    portalHref(props.workspaceId, `status/incidents/${id}`);

  return (
    <div className="portal-status space-y-10 max-w-4xl [&>section]:rounded-2xl [&>section]:border [&>section]:border-border [&>section]:p-6 [&_section>h2]:mb-5 [&_section>h2]:text-base [&_li]:text-sm [&_p]:text-sm">
      <section
        aria-labelledby="status-overview"
        className="portal-status-overview space-y-4 bg-muted [&_h2]:before:mr-2 [&_h2]:before:inline-block [&_h2]:before:size-2 [&_h2]:before:rounded-full [&_h2]:before:bg-warning [&[data-status=operational]_h2]:before:bg-success [&>p+p]:border-t [&>p+p]:border-border [&>p+p]:pt-3"
        data-status={props.page.topLevelStatus}
      >
        <h2 id="status-overview" className="text-xl font-semibold">
          {statusLabels[props.page.topLevelStatus]}
        </h2>
        {props.page.pageDescription ? (
          <p>{props.page.pageDescription}</p>
        ) : null}
        {components.map((component) => (
          <p key={component.id}>
            {t("status.componentStatus", {
              name: component.name,
              status: statusLabels[component.status],
            })}
          </p>
        ))}
      </section>
      <section aria-labelledby="status-active" className="space-y-3">
        <h2 id="status-active" className="text-xl font-semibold">
          {t("status.active")}
        </h2>
        {props.page.activeIncidents.length ? (
          <ul className="space-y-2">
            {props.page.activeIncidents.map((incident) => (
              <li key={incident.id}>
                <a
                  className="underline-offset-4 hover:underline"
                  href={incidentLink(incident.id)}
                >
                  {incident.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("status.noActive")}</p>
        )}
      </section>
      {props.page.upcomingMaintenance.length ? (
        <section aria-labelledby="status-maintenance" className="space-y-3">
          <h2 id="status-maintenance" className="text-xl font-semibold">
            {t("status.maintenance")}
          </h2>
          <ul>
            {props.page.upcomingMaintenance.map((incident) => (
              <li key={incident.id}>
                <a
                  className="underline-offset-4 hover:underline"
                  href={incidentLink(incident.id)}
                >
                  {incident.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="status-uptime" className="space-y-3">
        <h2 id="status-uptime" className="text-xl font-semibold">
          {t("status.uptime")}
        </h2>
        {props.uptime?.series.flatMap((series) =>
          series.days.slice(-7).map((day) => (
            <p key={`${series.componentId}-${day.date}`}>
              {t("status.uptimeDay", {
                date: day.date,
                percent: day.uptimePct,
              })}
            </p>
          )),
        )}
      </section>
      <section aria-labelledby="status-history" className="space-y-3">
        <h2 id="status-history" className="text-xl font-semibold">
          {t("status.history")}
        </h2>
        {props.incidents.length ? (
          <ul className="space-y-2">
            {props.incidents.map((incident) => (
              <li key={incident.id}>
                <a
                  className="underline-offset-4 hover:underline"
                  href={incidentLink(incident.id)}
                >
                  {incident.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("status.noHistory")}</p>
        )}
        {props.hasMore ? (
          <Button onClick={props.onLoadMore} disabled={props.loadingMore}>
            {t("status.loadMore")}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
