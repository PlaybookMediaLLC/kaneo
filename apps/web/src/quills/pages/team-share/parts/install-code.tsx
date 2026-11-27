import { useTranslation } from "react-i18next";
import { useMintWidgetInstallCode } from "../../../hooks/team/use-mint-widget-install-code";
import { ConfirmAction } from "../../../ui/confirm-action";
import { CopyField } from "../../../ui/copy-field";
import { Button, copyToClipboard } from "../../../ui/upstream";
import { tellCopy } from "../copy-rich";
import { aiInstallPrompt } from "../share-links";

export interface InstallCodeProps {
  workspaceId: string;
  /** Workspace slug used to build the AI setup prompt URL. */
  slug?: string;
  /** Instance API base URL ending in /api. */
  apiBase?: string;
}

/**
 * "Create install code": a short code for the widget setup. The API says that it expires
 * after 15 minutes and works twice. When slug and apiBase are provided, it also builds a
 * ready-to-paste prompt for AI coding agents.
 */
export function InstallCode({ workspaceId, slug, apiBase }: InstallCodeProps) {
  const { t, i18n } = useTranslation("quills");
  const mint = useMintWidgetInstallCode();
  const prompt =
    mint.data && slug && apiBase
      ? aiInstallPrompt(apiBase, slug, mint.data.code)
      : null;
  return (
    <div className="grid gap-2">
      <ConfirmAction
        labelKey="team-share.widget.installCode"
        onConfirm={async () => {
          await mint.mutateAsync({ param: { workspaceId } });
        }}
      />
      {mint.data ? (
        <div className="grid gap-2">
          <div className="grid gap-1">
            <CopyField
              value={mint.data.code}
              label={t("team-share.widget.code")}
            />
            <p className="text-xs text-muted-foreground">
              {t("team-share.widget.expires", {
                time: new Date(mint.data.expiresAt).toLocaleTimeString(
                  i18n.language,
                  {
                    hour: "numeric",
                    minute: "2-digit",
                  },
                ),
              })}
            </p>
          </div>
          {prompt ? (
            <div className="grid gap-1.5 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {t("team-share.widget.aiPrompt")}
                </span>
                <Button
                  size="xs"
                  onClick={() => void tellCopy(copyToClipboard(prompt), t)}
                >
                  {t("team-share.widget.aiPromptCopy")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("team-share.widget.aiPromptHelp")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
