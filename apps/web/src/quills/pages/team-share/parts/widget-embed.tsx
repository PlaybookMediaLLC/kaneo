import { brandText } from "@kaneo/branding";
import { useTranslation } from "react-i18next";
import { Button, copyToClipboard } from "../../../ui/upstream";
import { tellCopy } from "../copy-rich";
import { widgetSnippets } from "../share-links";
import { CodeBlock } from "./code-block";
import { InstallCode } from "./install-code";

export interface WidgetEmbedProps {
  workspaceId: string;
  /** The workspace slug in the SDK URL. */
  slug: string;
  /** The API base URL of this instance, ending in /api. */
  apiBase: string;
  /** The install code needs manage_settings. */
  canMintCode: boolean;
}

/** The three widget snippets, "Copy all", the install code and the docs link. */
export function WidgetEmbed({
  workspaceId,
  slug,
  apiBase,
  canMintCode,
}: WidgetEmbedProps) {
  const { t } = useTranslation("quills");
  const code = widgetSnippets(apiBase, slug);
  const steps = [
    { label: t("team-share.widget.load"), code: code.load },
    { label: t("team-share.widget.start"), code: code.start },
  ];
  return (
    <div className="grid gap-4">
      {steps.map((step) => (
        <div key={step.label} className="grid gap-2">
          <h3 className="text-sm font-medium">{step.label}</h3>
          <CodeBlock label={step.label} code={step.code} />
        </div>
      ))}
      <div className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">
          {t("team-share.widget.identify")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("team-share.widget.identifyText")}
        </p>
        <CodeBlock
          label={t("team-share.widget.identify")}
          code={code.identify}
        />
        <CodeBlock
          label={t("team-share.widget.serverSign")}
          code={code.serverSign}
        />
      </div>
      <div className="grid gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">{t("team-share.widget.proxy")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("team-share.widget.proxyText")}
        </p>
        <CodeBlock label={t("team-share.widget.proxy")} code={code.proxy} />
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Button
          className="rounded-full"
          onClick={() =>
            void tellCopy(
              copyToClipboard(
                [code.load, code.start, code.identify].join("\n"),
              ),
              t,
            )
          }
        >
          {t("team-share.widget.copyAll")}
        </Button>
        {canMintCode ? (
          <InstallCode
            key={workspaceId}
            workspaceId={workspaceId}
            slug={slug}
            apiBase={apiBase}
          />
        ) : null}
        <a
          href={brandText("https://kaneo.app/docs/quills/widget")}
          target="_blank"
          rel="noreferrer"
          className="self-center text-sm text-muted-foreground hover:text-foreground"
        >
          {t("team-share.widget.docs")}
        </a>
      </div>
    </div>
  );
}
