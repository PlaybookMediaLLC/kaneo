import { portalHref } from "../../core/portal-href";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useListPortalRoadmaps } from "../../hooks/feedback/use-list-portal-roadmaps";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { StateView } from "../../ui/state-view";
import { PortalGate } from "../../ui/portal-gate";
import { PortalSelectContent } from "../../ui/portal-select-content";
import {
  Field,
  FieldLabel,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectItem,
} from "../../ui/upstream";
import { RoadmapBoard } from "./parts/roadmap-board";

export interface RoadmapPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function RoadmapPage(props: RoadmapPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const navigate = useNavigate();
  const roadmaps = useListPortalRoadmaps(
    {
      param: {
        workspace:
          portal.access?.granted && !portal.accessLoading
            ? props.workspaceId
            : "",
      },
    },
    portal.viewer,
  );
  const selected =
    roadmaps.data?.roadmaps.find(
      (item) => item.slug === props.search.roadmap,
    ) ?? (props.search.roadmap ? undefined : roadmaps.data?.roadmaps[0]);
  const search =
    typeof props.search.search === "string"
      ? props.search.search.slice(0, 200)
      : "";
  const sort =
    props.search.sort === "newest" || props.search.sort === "oldest"
      ? props.search.sort
      : "votes";
  const change = (patch: Record<string, string>) => {
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        ...patch,
      }),
      replace: true,
      resetScroll: false,
    });
  };
  return (
    <PageFrame titleKey="feedback.roadmapTitle">
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "roadmap")}
          audience="portal"
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={roadmaps.isLoading}
            problem={roadmaps.error}
            empty={roadmaps.data?.roadmaps.length === 0}
            onRetry={() => {
              void roadmaps.refetch();
            }}
          >
            <div className="flex flex-col gap-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="roadmap-select">
                    {t("feedback.roadmapTitle")}
                  </FieldLabel>
                  <Select
                    items={
                      roadmaps.data?.roadmaps.map((item) => ({
                        value: item.slug,
                        label: item.name,
                      })) ?? []
                    }
                    value={selected?.slug ?? ""}
                    onValueChange={(value) => {
                      if (value) change({ roadmap: value });
                    }}
                  >
                    <SelectTrigger id="roadmap-select">
                      <SelectValue />
                    </SelectTrigger>
                    <PortalSelectContent>
                      <SelectGroup>
                        {roadmaps.data?.roadmaps.map((item) => (
                          <SelectItem key={item.id} value={item.slug}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </PortalSelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="roadmap-search">
                    {t("feedback.search")}
                  </FieldLabel>
                  <Input
                    id="roadmap-search"
                    value={search}
                    maxLength={200}
                    onChange={(event) => change({ search: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="roadmap-sort">
                    {t("feedback.sort")}
                  </FieldLabel>
                  <Select
                    items={["votes", "newest", "oldest"].map((value) => ({
                      value,
                      label: t(`feedback.${value}`),
                    }))}
                    value={sort}
                    onValueChange={(value) => {
                      if (value) change({ sort: value });
                    }}
                  >
                    <SelectTrigger id="roadmap-sort">
                      <SelectValue />
                    </SelectTrigger>
                    <PortalSelectContent>
                      <SelectGroup>
                        {["votes", "newest", "oldest"].map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`feedback.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </PortalSelectContent>
                  </Select>
                </Field>
              </div>
              {selected ? (
                <>
                  <p className="text-muted-foreground">
                    {selected.description}
                  </p>
                  <RoadmapBoard
                    key={selected.id}
                    workspaceId={props.workspaceId}
                    viewer={portal.viewer}
                    roadmap={selected}
                    search={search}
                    sort={sort}
                  />
                </>
              ) : (
                <StateView problem={{ kind: "notFound" }}>{null}</StateView>
              )}
            </div>
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
