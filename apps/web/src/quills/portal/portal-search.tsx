import { IconMagnifierOutline18 } from "nucleo-ui-essential-outline-18";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { useListPortalPosts } from "../hooks/feedback/use-list-portal-posts";
import { useSearchPublicHelpCenter } from "../hooks/help-center/use-search-public-help-center";
import { PortalDialogContent } from "../ui/portal-dialog-content";
import { StatusIcon } from "../ui/post/status-icon";
import { StateView } from "../ui/state-view";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogTrigger,
  Kbd,
} from "../ui/upstream";
import { usePortalRuntime } from "./runtime";

export interface PortalSearchProps {
  workspaceId: string;
}

const row =
  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

/** Header search across feedback posts and help articles; Cmd+K or Ctrl+K opens it. */
export function PortalSearch({ workspaceId }: PortalSearchProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const ready = open && term.length >= 2;
  const posts = useListPortalPosts(
    {
      param: {
        workspace: ready && portal.access?.granted ? workspaceId : "",
      },
      query: { search: term || undefined, sort: "votes", limit: "5" },
    },
    portal.viewer,
  );
  const articles = useSearchPublicHelpCenter(
    {
      param: { workspace: ready ? workspaceId : "" },
      json: { query: term, limit: 5 },
    },
    portal.viewer,
  );
  const postItems = posts.data?.pages[0]?.items ?? [];
  const articleItems = articles.data?.articles ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label={t("core.search")}
          />
        }
      >
        <IconMagnifierOutline18 aria-hidden="true" />
      </DialogTrigger>
      <PortalDialogContent
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="max-w-xl overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{t("core.search")}</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <IconMagnifierOutline18
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          <input
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label={t("core.searchLabel")}
            placeholder={t("core.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Kbd>{t("core.searchShortcut")}</Kbd>
        </div>
        {ready ? (
          <div className="max-h-96 overflow-y-auto p-2 [&_h2]:px-2.5 [&_h2]:pb-1 [&_h2]:pt-2 [&_h2]:text-xs [&_h2]:font-normal [&_h2]:text-muted-foreground">
            <StateView
              loading={posts.isLoading || articles.isLoading}
              // A workspace without a help center answers 404; feedback results still show.
              problem={posts.error ?? null}
              onRetry={() => {
                void posts.refetch();
                void articles.refetch();
              }}
            >
              {postItems.length ? (
                <section aria-labelledby="search-feedback">
                  <h2 id="search-feedback">{t("core.navFeedback")}</h2>
                  <ul>
                    {postItems.map((post) => (
                      <li key={post.id}>
                        <a
                          className={row}
                          href={portalHref(workspaceId, `posts/${post.id}`)}
                        >
                          <StatusIcon
                            stage={post.stage}
                            color={post.status?.color}
                            className="size-3.5"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {post.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("post.votes", { count: post.voteCount })}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {articleItems.length ? (
                <section aria-labelledby="search-help">
                  <h2 id="search-help">{t("core.navHelp")}</h2>
                  <ul>
                    {articleItems.map((article) => (
                      <li key={article.id}>
                        <a
                          className={row}
                          href={portalHref(workspaceId, article.path)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {article.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {article.category.name}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!postItems.length && !articleItems.length ? (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                  {t("core.searchEmpty")}
                </p>
              ) : null}
            </StateView>
          </div>
        ) : null}
      </PortalDialogContent>
    </Dialog>
  );
}
