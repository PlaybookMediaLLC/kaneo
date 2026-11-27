import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiOrigin } from "../../../core/api-origin";
import {
  Button,
  Input,
  Label,
  SettingsCard,
  SettingsSection,
} from "../../../ui/upstream";

export interface EmailTemplateEditorProps {
  workspaceId: string;
  brandName: string;
  disabled?: boolean;
}

/**
 * Split-pane visual block + raw HTML email template editor with sandboxed live preview
 * and rate-limited Send Test (#332). Preview and Send Test invoke the exact same renderer.
 */
export function EmailTemplateEditor({
  workspaceId,
  brandName,
  disabled,
}: EmailTemplateEditorProps) {
  const { t } = useTranslation("quills");
  const baseId = useId();
  const [mode, setMode] = useState<"blocks" | "html">("blocks");
  const [subject, setSubject] = useState("Update on {{subject}}");
  const [heading, setHeading] = useState("Hi {{customerName}},");
  const [body, setBody] = useState(
    "We've replied to your conversation and wanted to share the latest update.",
  );
  const [buttonLabel, setButtonLabel] = useState("View conversation");
  const [buttonUrl, setButtonUrl] = useState(
    "https://example.com/portal/r/demo",
  );
  const [htmlBody, setHtmlBody] = useState(
    "<p>Hi {{customerName}},</p><p>We've replied to your request.</p>",
  );
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [testTo, setTestTo] = useState("");
  const [status, setStatus] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const buildPayload = () => ({
    brand: { name: brandName || "Support" },
    subject,
    mode,
    blocksJson: [
      { id: "h1", type: "header", content: heading },
      { id: "t1", type: "text", content: body },
      { id: "b1", type: "button", label: buttonLabel, url: buttonUrl },
    ],
    htmlBody: mode === "html" ? htmlBody : null,
    variables: {
      customerName: "Alex",
      subject: "Account access question",
    },
  });

  const handlePreview = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/settings/email-templates/preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildPayload()),
        },
      );
      if (!res.ok) throw new Error("preview failed");
      const data = (await res.json()) as { html: string };
      setPreviewHtml(data.html);
    } catch {
      setStatus({
        kind: "error",
        message: t("settings-workspace.branding.emailTemplates.previewFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendTest = async () => {
    if (!testTo.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/settings/email-templates/send-test`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...buildPayload(), to: testTo.trim() }),
        },
      );
      if (!res.ok) throw new Error("send test failed");
      const data = (await res.json()) as { html: string };
      setPreviewHtml(data.html);
      setStatus({
        kind: "success",
        message: t("settings-workspace.branding.emailTemplates.sentTest"),
      });
    } catch {
      setStatus({
        kind: "error",
        message: t("settings-workspace.branding.emailTemplates.sendTestFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={t("settings-workspace.branding.emailTemplates.title")}
    >
      <SettingsCard>
        <div className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            {t("settings-workspace.branding.emailTemplates.description")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "blocks" ? "default" : "outline"}
              disabled={disabled}
              onClick={() => setMode("blocks")}
            >
              {t("settings-workspace.branding.emailTemplates.modeBlocks")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "html" ? "default" : "outline"}
              disabled={disabled}
              onClick={() => setMode("html")}
            >
              {t("settings-workspace.branding.emailTemplates.modeHtml")}
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`${baseId}-subject`}>
                  {t("settings-workspace.branding.emailTemplates.subject")}
                </Label>
                <Input
                  id={`${baseId}-subject`}
                  value={subject}
                  disabled={disabled}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              {mode === "blocks" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-heading`}>
                      {t("settings-workspace.branding.emailTemplates.heading")}
                    </Label>
                    <Input
                      id={`${baseId}-heading`}
                      value={heading}
                      disabled={disabled}
                      onChange={(e) => setHeading(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${baseId}-body`}>
                      {t("settings-workspace.branding.emailTemplates.body")}
                    </Label>
                    <textarea
                      id={`${baseId}-body`}
                      rows={3}
                      value={body}
                      disabled={disabled}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`${baseId}-button-label`}>
                        {t(
                          "settings-workspace.branding.emailTemplates.buttonLabel",
                        )}
                      </Label>
                      <Input
                        id={`${baseId}-button-label`}
                        value={buttonLabel}
                        disabled={disabled}
                        onChange={(e) => setButtonLabel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`${baseId}-button-url`}>
                        {t(
                          "settings-workspace.branding.emailTemplates.buttonUrl",
                        )}
                      </Label>
                      <Input
                        id={`${baseId}-button-url`}
                        value={buttonUrl}
                        disabled={disabled}
                        onChange={(e) => setButtonUrl(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor={`${baseId}-html-body`}>
                    {t("settings-workspace.branding.emailTemplates.htmlBody")}
                  </Label>
                  <textarea
                    id={`${baseId}-html-body`}
                    rows={7}
                    value={htmlBody}
                    disabled={disabled}
                    onChange={(e) => setHtmlBody(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || busy}
                  onClick={() => void handlePreview()}
                >
                  {t("settings-workspace.branding.emailTemplates.preview")}
                </Button>
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="email"
                    aria-label={t(
                      "settings-workspace.branding.emailTemplates.sendTestTo",
                    )}
                    placeholder={t(
                      "settings-workspace.branding.emailTemplates.sendTestTo",
                    )}
                    value={testTo}
                    disabled={disabled}
                    onChange={(e) => setTestTo(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled || busy || !testTo.trim()}
                    onClick={() => void handleSendTest()}
                  >
                    {t("settings-workspace.branding.emailTemplates.sendTest")}
                  </Button>
                </div>
              </div>
              {status ? (
                <p
                  role={status.kind === "error" ? "alert" : "status"}
                  className={
                    status.kind === "error"
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {status.message}
                </p>
              ) : null}
            </div>

            <div className="min-h-[260px] overflow-hidden rounded-md border border-border bg-muted/20">
              {previewHtml ? (
                <iframe
                  title={t(
                    "settings-workspace.branding.emailTemplates.previewTitle",
                  )}
                  sandbox=""
                  srcDoc={previewHtml}
                  className="h-[320px] w-full border-0 bg-white"
                />
              ) : (
                <div className="flex h-full min-h-[260px] items-center justify-center p-6 text-center text-xs text-muted-foreground">
                  {t("settings-workspace.branding.emailTemplates.previewTitle")}
                </div>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
