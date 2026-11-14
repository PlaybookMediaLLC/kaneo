import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { useTranslatePortalContent } from "../../../hooks/feedback/use-translate-portal-content";
import { MarkdownContent } from "../../../ui/markdown-content";

export interface TranslatedTextProps {
  workspaceId: string;
  viewer: Viewer;
  /** The post or the comment that holds the text. */
  target: { postId: string } | { commentId: string };
  content: string;
  className?: string;
}

// ponytail: the content language is taken to be English, the only portal language today.
// Compare with a workspace language setting when one exists.
/** The browser language when it is not English, else null: then no text offers a translation. */
export const browserLocale = () => {
  const locale = globalThis.navigator?.language ?? "en";
  return /^en(-|$)/i.test(locale) ? null : locale;
};

/** A post or comment text with "Translate" when the browser language is not English. A post's translated title shows above its text. */
export function TranslatedText(props: TranslatedTextProps) {
  const { t } = useTranslation("quills");
  // The toggle belongs to one text: after an edit the new original shows.
  const [translatedFor, setTranslatedFor] = useState<string | null>(null);
  const on = translatedFor === props.content;
  const locale = browserLocale();
  const translation = useTranslatePortalContent(
    {
      param: { workspace: on && locale ? props.workspaceId : "" },
      json: { ...props.target, locale: locale ?? "" },
    },
    props.viewer,
  );
  const shown = on ? translation.data : undefined;
  return (
    <>
      {shown?.title ? <p className="font-medium">{shown.title}</p> : null}
      <MarkdownContent
        customer
        content={shown?.content ?? props.content}
        className={props.className}
      />
      {locale ? (
        <button
          type="button"
          className="justify-self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setTranslatedFor(on ? null : props.content)}
        >
          {t(on ? "assist.showOriginal" : "assist.translate")}
        </button>
      ) : null}
      {on && translation.isFetching ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("assist.translating")}
        </p>
      ) : null}
      {on && translation.error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {t("assist.translateFailed")}
        </p>
      ) : null}
    </>
  );
}
