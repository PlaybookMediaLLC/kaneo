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
}

export function PageFrame({
  titleKey,
  displayTitle,
  children,
  token = "none",
  tokenScope,
  persistToken = false,
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

  return (
    <main
      className={cn(
        "portal-page mx-auto w-full flex-1 px-5 pb-16 pt-8 md:px-8 md:pt-12 [&_h2]:tracking-tight [&_h3]:font-semibold [&_time]:text-xs [&_time]:text-muted-foreground",
        [
          "feedback.title",
          "feedback.roadmapTitle",
          "help-center.title",
          "help-center.categoryTitle",
          "help-center.articleTitle",
          "changelog.title",
        ].includes(titleKey)
          ? "max-w-6xl"
          : "max-w-3xl",
      )}
      data-page={titleKey}
    >
      {token !== "none" ? <meta name="referrer" content="no-referrer" /> : null}
      <h1
        ref={heading}
        tabIndex={-1}
        className={cn(
          "portal-page-title mb-8 text-3xl font-semibold leading-tight tracking-tight outline-none md:text-4xl",
          titleKey === "feedback.title" ? "md:ml-[228px]" : "",
          [
            "help-center.title",
            "help-center.categoryTitle",
            "help-center.articleTitle",
          ].includes(titleKey)
            ? "md:ml-[252px]"
            : "",
        )}
      >
        {title}
      </h1>
      <div className="portal-page-content min-w-0 [&>*+*]:mt-6">{children}</div>
    </main>
  );
}
