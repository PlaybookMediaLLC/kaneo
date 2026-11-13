import { useTranslation } from "react-i18next";
import { portalHref } from "../core/portal-href";
import { PortalSheetContent } from "./portal-sheet-content";
import {
  Button,
  Sheet,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetPanel,
  cn,
} from "./upstream";

export interface HelpNavigationProps {
  workspaceId: string;
  locale?: string;
  categories: Array<{
    id: string;
    name: string;
    path: string;
    parentId: string | null;
  }>;
  categoryId?: string;
  articleId?: string;
  articles?: Array<{ id: string; title: string; path: string }>;
}
export function HelpNavigation({
  workspaceId,
  locale = "en",
  categories,
  categoryId,
  articleId,
  articles = [],
}: HelpNavigationProps) {
  const { t } = useTranslation("quills");
  const navigation = (
    <nav
      aria-label={t("help-center.collections")}
      className="flex flex-col gap-1 text-sm"
    >
      <a
        className="rounded-lg px-3 py-2 hover:bg-muted"
        href={portalHref(workspaceId, locale === "en" ? "hc" : `hc/${locale}`)}
      >
        {t("help-center.back")}
      </a>
      {categories.map((category) => (
        <div key={category.id}>
          <a
            className={cn(
              "block rounded-lg px-3 py-2 font-medium hover:bg-muted",
              category.parentId && "ml-3",
              category.id === categoryId && "bg-muted text-foreground",
            )}
            href={portalHref(workspaceId, category.path)}
            aria-current={
              category.id === categoryId && !articleId ? "page" : undefined
            }
          >
            {category.name}
          </a>
          {category.id === categoryId && articles.length > 0 ? (
            <ul className="ml-4 border-l border-border pl-2">
              {articles.map((article) => (
                <li key={article.id}>
                  <a
                    className={cn(
                      "block rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground",
                      article.id === articleId && "bg-muted text-foreground",
                    )}
                    href={portalHref(workspaceId, article.path)}
                    aria-current={article.id === articleId ? "page" : undefined}
                  >
                    {article.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </nav>
  );
  return (
    <aside className="min-w-0 md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:overflow-y-auto">
      <div className="hidden md:block">
        <h2 className="mb-3 px-3 text-sm font-semibold">
          {t("help-center.collections")}
        </h2>
        {navigation}
      </div>
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>
            {t("help-center.browse")}
          </SheetTrigger>
          <PortalSheetContent>
            <SheetHeader>
              <SheetTitle>{t("help-center.collections")}</SheetTitle>
            </SheetHeader>
            <SheetPanel>{navigation}</SheetPanel>
          </PortalSheetContent>
        </Sheet>
      </div>
    </aside>
  );
}
