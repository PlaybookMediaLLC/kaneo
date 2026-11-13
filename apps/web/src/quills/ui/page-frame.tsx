import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { removeTokenFromAddress, stashToken } from "../core/token-stash";

export interface PageFrameProps {
  titleKey: string;
  children: ReactNode;
  token?: "none" | "query" | "fragment";
  tokenScope?: string;
  persistToken?: boolean;
}

export function PageFrame({
  titleKey,
  children,
  token = "none",
  tokenScope,
  persistToken = false,
}: PageFrameProps) {
  const { t } = useTranslation("quills");
  const heading = useRef<HTMLHeadingElement>(null);
  const title = t(titleKey);

  useEffect(() => {
    document.title = title;
    heading.current?.focus();
  }, [title]);

  useEffect(() => {
    if (token === "none" || !tokenScope) return;
    const value = removeTokenFromAddress(token);
    if (value) stashToken(tokenScope, value, persistToken);
  }, [persistToken, token, tokenScope]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      {token !== "none" ? <meta name="referrer" content="no-referrer" /> : null}
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none"
      >
        {title}
      </h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
