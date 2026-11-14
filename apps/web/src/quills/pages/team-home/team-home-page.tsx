import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useFetchAdminOverview } from "../../hooks/team/use-fetch-admin-overview";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";

export interface TeamHomePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const heading = "text-base font-semibold";
const list = "mt-3 divide-y divide-border rounded-lg border border-border";
const row =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3";
const muted = "text-sm text-muted-foreground";

// The team overview: what waits for review, what shipped, what gains votes, and the boards.
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
  const feedback = overview.data?.feedback;
  const postSections = feedback
    ? [
        {
          id: "team-home-review",
          titleKey: "team.home.review",
          count: feedback.reviewCount,
          posts: feedback.review,
        },
        {
          id: "team-home-announce",
          titleKey: "team.home.announce",
          count: feedback.completeCount,
          posts: feedback.announce,
        },
      ]
    : [];

  return (
    <PageFrame
      titleKey="team.title"
      description={t("team.home.description")}
      landmark={false}
      wide
    >
      <TeamStateView
        loading={overview.isLoading || boards.isLoading}
        problem={overview.error ?? boards.error ?? null}
        onRetry={() => {
          void overview.refetch();
          void boards.refetch();
        }}
      >
        {postSections.map((section) => (
          <section key={section.id} aria-labelledby={section.id}>
            <h2 id={section.id} className={heading}>
              {t(section.titleKey, { count: section.count })}
            </h2>
            {section.posts.length ? (
              <ul className={list}>
                {section.posts.map((post) => (
                  <li key={post.id} className={row}>
                    <span className="font-medium">{post.title}</span>
                    <span className={muted}>
                      {t("team.home.place", {
                        board: post.boardName,
                        status: post.statusName,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`mt-2 ${muted}`}>{t("team.home.none")}</p>
            )}
          </section>
        ))}
        <section aria-labelledby="team-home-momentum">
          <h2 id="team-home-momentum" className={heading}>
            {t("team.home.momentum")}
          </h2>
          {overview.data?.momentum.length ? (
            <ul className={list}>
              {overview.data.momentum.map((post) => (
                <li key={post.postId} className={row}>
                  <span className="font-medium">{post.title}</span>
                  <span className={muted}>
                    {t("team.home.votes", { count: post.votesLast7d })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-2 ${muted}`}>{t("team.home.none")}</p>
          )}
        </section>
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
    </PageFrame>
  );
}
