import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiOrigin } from "../../../core/api-origin";
import { Button, SettingsCard, SettingsSection } from "../../../ui/upstream";

type ProxyTarget = "nginx" | "cloudflare" | "caddy" | "vercel";

function buildSnippet(
  target: ProxyTarget,
  origin: string,
  workspaceId: string,
) {
  const upstream = `${origin}/api/quills-public/${workspaceId}/widget`;
  switch (target) {
    case "nginx":
      return `location /support-widget/ {\n  proxy_pass ${upstream}/;\n  proxy_hide_header Set-Cookie;\n  proxy_set_header Cookie "";\n}`;
    case "cloudflare":
      return `export default {\n  async fetch(req) {\n    const u = new URL(req.url);\n    const suffix = u.pathname.replace(/^\\/support-widget/, "");\n    const h = new Headers(req.headers); h.delete("cookie");\n    const res = await fetch("${upstream}" + suffix + u.search, { method: req.method, headers: h, body: req.body });\n    const out = new Response(res.body, res); out.headers.delete("set-cookie");\n    return out;\n  }\n};`;
    case "caddy":
      return `handle_path /support-widget/* {\n  rewrite * /api/quills-public/${workspaceId}/widget{uri}\n  reverse_proxy ${origin} {\n    header_up -Cookie\n    header_down -Set-Cookie\n  }\n}`;
    case "vercel":
      return JSON.stringify(
        {
          rewrites: [
            {
              source: "/support-widget/:path*",
              destination: `${upstream}/:path*`,
            },
          ],
        },
        null,
        2,
      );
  }
}

export function WidgetProxySnippets({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("quills");
  const [target, setTarget] = useState<ProxyTarget>("nginx");
  const origin =
    apiOrigin() ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "https://support.example.com");
  const snippet = buildSnippet(target, origin, workspaceId);

  return (
    <SettingsSection title={t("settings-workspace.domain.widgetProxyTitle")}>
      <SettingsCard>
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            {t("settings-workspace.domain.widgetProxyNote")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["nginx", "cloudflare", "caddy", "vercel"] as const).map(
              (key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={target === key ? "default" : "outline"}
                  onClick={() => setTarget(key)}
                >
                  {key === "cloudflare"
                    ? "Cloudflare"
                    : key === "nginx"
                      ? "Nginx"
                      : key === "caddy"
                        ? "Caddy"
                        : "Vercel"}
                </Button>
              ),
            )}
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
            <code>{snippet}</code>
          </pre>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
