import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./upstream";
import { removeTokenFromAddress, stashToken } from "../core/token-stash";

export interface PageFrameProps {
  titleKey: string;
  displayTitle?: string;
  children: ReactNode;
  token?: "none" | "query" | "fragment";
  tokenScope?: string;
  persistToken?: boolean;
  /** A rail beside the title and content, such as board or help navigation. */
  aside?: ReactNode;
  /** Context above the title, such as a breadcrumb. */
  eyebrow?: ReactNode;
  /** A short line under the title. */
  description?: ReactNode;
  /** Controls at the end of the title row. */
  actions?: ReactNode;
  /** Use the full portal width for boards, lists and grids. */
  wide?: boolean;
}

export function PageFrame({
  titleKey,
  displayTitle,
  children,
  token = "none",
  tokenScope,
  persistToken = false,
  aside,
  eyebrow,
  description,
  actions,
  wide = false,
}: PageFrameProps) {
  const { t } = useTranslation("quills");
  const heading = useRef<HTMLHeadingElement>(null);
  const title = displayTitle || t(titleKey);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    heading.current?.focus();
  }, [titleKey]);

  useEffect(() => {
    if (token === "none" || !tokenScope) return;
    const value = removeTokenFromAddress(token);
    if (value) stashToken(tokenScope, value, persistToken);
  }, [persistToken, token, tokenScope]);

  const header = (
    <div className="portal-page-header mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:col-start-2">
      <div className="min-w-0">
        {eyebrow}
        <h1
          ref={heading}
          tabIndex={-1}
          className="portal-page-title text-3xl font-semibold leading-tight tracking-tight outline-none md:text-4xl"
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
  const content = (
    <div className="portal-page-content min-w-0 md:col-start-2 [&>*+*]:mt-6">
      {children}
    </div>
  );

  return (
    <main
      className={cn(
        "portal-page mx-auto w-full flex-1 px-5 pb-16 pt-8 md:pt-12 [&_h2]:tracking-tight [&_h3]:font-semibold [&_time]:text-xs [&_time]:text-muted-foreground",
        wide || aside ? "max-w-4xl" : "max-w-3xl",
      )}
      data-page={titleKey}
    >
      {token !== "none" ? <meta name="referrer" content="no-referrer" /> : null}
      {aside ? (
        <div className="grid items-start gap-x-14 md:grid-cols-[180px_minmax(0,1fr)]">
          {header}
          <div className="mb-8 min-w-0 md:col-start-1 md:row-span-2 md:row-start-1 md:mb-0 md:self-stretch">
            {aside}
          </div>
          {content}
        </div>
      ) : (
        <>
          {header}
          {content}
        </>
      )}
    </main>
  );
}
