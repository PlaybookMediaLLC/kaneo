import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useFetchAdminOverview } from "../../hooks/team/use-fetch-admin-overview";
import { useGetTeamCounts } from "../../hooks/team/use-get-team-counts";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { RequestRow } from "../../ui/inbox/request-row";
import { PageFrame } from "../../ui/page-frame";
import { ViewLinks } from "./parts/view-links";

export interface TeamHomePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const heading = "text-sm font-semibold";

// The overview: the count of each view with a link to it, then what waits on the feedback boards.
// A post row opens the post in the teammate app; a board row opens the board on the portal.
export function TeamHomePage({ workspaceId }: TeamHomePageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const overview = useFetchAdminOverview(
    { param: { workspaceId } },
    team.viewer,
  );
  // ponytail: the first 100 boards (the API maximum); page them when a workspace has more.
  const boards = useListBoards(
    {
      param: { workspaceId },
      query: { counts: "true", offset: "0", limit: "100" },
    },
    team.viewer,
  );
  // The counts are only labels, as in the section nav: a failed request shows none.
  const counts = useGetTeamCounts({ param: { workspaceId } }, team.viewer);
  const feedback = overview.data?.feedback;
  const post = (id: string) =>
    teamHref(workspaceId, `/posts/${encodeURIComponent(id)}`);
  const sections = [
    {
      id: "team-home-review",
      title: t("team.home.review", { count: feedback?.reviewCount ?? 0 }),
      items: (feedback?.review ?? []).map((item) => ({
        id: item.id,
        href: post(item.id),
        title: item.title,
        detail: t("team.home.place", {
          board: item.boardName,
          status: item.statusName,
        }),
        time: item.at,
      })),
    },
    {
      id: "team-home-announce",
      title: t("team.home.announce", { count: feedback?.completeCount ?? 0 }),
      items: (feedback?.announce ?? []).map((item) => ({
        id: item.id,
        href: post(item.id),
        title: item.title,
        detail: t("team.home.place", {
          board: item.boardName,
          status: item.statusName,
        }),
        time: item.at,
      })),
    },
    {
      id: "team-home-momentum",
      title: t("team.home.momentum"),
      items: (overview.data?.momentum ?? []).map((item) => ({
        id: item.postId,
        href: post(item.postId),
        title: item.title,
        detail: t("team.home.votes", { count: item.votesLast7d }),
      })),
    },
    {
      id: "team-home-boards",
      title: t("team.home.boards"),
      items: (boards.data?.items ?? []).map((board) => ({
        id: board.id,
        href: portalHref(workspaceId, `boards/${board.id}`),
        title: board.name,
        detail: t("team.home.posts", { count: board.postCount ?? 0 }),
      })),
    },
  ];

  return (
    <PageFrame titleKey="team.nav.home" variant="app" landmark={false}>
      <ListHeader title={t("team.nav.home")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-5">
          <ViewLinks workspaceId={workspaceId} counts={counts.data} />
          <TeamStateView
            loading={overview.isLoading || boards.isLoading}
            problem={overview.error ?? boards.error ?? null}
            onRetry={() => {
              void overview.refetch();
              void boards.refetch();
            }}
          >
            {sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <h2 id={section.id} className={heading}>
                  {section.title}
                </h2>
                {section.items.length ? (
                  <ul className="-mx-3 mt-2 grid gap-0.5">
                    {section.items.map(({ id, ...item }) => (
                      <li key={id}>
                        <RequestRow
                          {...item}
                          onOpen={() => void navigate({ to: item.href })}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("team.home.none")}
                  </p>
                )}
              </section>
            ))}
          </TeamStateView>
        </div>
      </div>
    </PageFrame>
  );
}
