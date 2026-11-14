import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useFetchAdminOverview } from "../../hooks/team/use-fetch-admin-overview";
import { useGetTeamCounts } from "../../hooks/team/use-get-team-counts";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ListHeader } from "../../ui/inbox/list-header";
import { PageFrame } from "../../ui/page-frame";
import { ViewLinks } from "./parts/view-links";

export interface TeamHomePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const heading = "text-sm font-semibold";
const list = "mt-2 divide-y divide-border rounded-lg border border-border";
const row =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm";
const muted = "text-sm text-muted-foreground";

// The overview: the count of each view with a link to it, then what waits on the feedback boards.
export function TeamHomePage({ workspaceId }: TeamHomePageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
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
  const sections = [
    {
      id: "team-home-review",
      title: t("team.home.review", { count: feedback?.reviewCount ?? 0 }),
      items: (feedback?.review ?? []).map((post) => ({
        id: post.id,
        title: post.title,
        detail: t("team.home.place", {
          board: post.boardName,
          status: post.statusName,
        }),
      })),
    },
    {
      id: "team-home-announce",
      title: t("team.home.announce", { count: feedback?.completeCount ?? 0 }),
      items: (feedback?.announce ?? []).map((post) => ({
        id: post.id,
        title: post.title,
        detail: t("team.home.place", {
          board: post.boardName,
          status: post.statusName,
        }),
      })),
    },
    {
      id: "team-home-momentum",
      title: t("team.home.momentum"),
      items: (overview.data?.momentum ?? []).map((post) => ({
        id: post.postId,
        title: post.title,
        detail: t("team.home.votes", { count: post.votesLast7d }),
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
                  <ul className={list}>
                    {section.items.map((item) => (
                      <li key={item.id} className={row}>
                        <span className="font-medium">{item.title}</span>
                        <span className={muted}>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`mt-2 ${muted}`}>{t("team.home.none")}</p>
                )}
              </section>
            ))}
            <section aria-labelledby="team-home-boards">
              <h2 id="team-home-boards" className={heading}>
                {t("team.home.boards")}
              </h2>
              {boards.data?.items.length ? (
                <ul className={list}>
                  {boards.data.items.map((board) => (
                    <li key={board.id} className={row}>
                      <a
                        className="font-medium underline-offset-4 hover:underline"
                        href={portalHref(workspaceId, `boards/${board.id}`)}
                      >
                        {board.name}
                      </a>
                      <span className={muted}>
                        {t("team.home.posts", { count: board.postCount ?? 0 })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-2 ${muted}`}>{t("team.home.none")}</p>
              )}
            </section>
          </TeamStateView>
        </div>
      </div>
    </PageFrame>
  );
}
