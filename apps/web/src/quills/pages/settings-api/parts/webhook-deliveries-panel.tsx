import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiOrigin } from "../../../core/api-origin";
import { Button, SettingsCard, SettingsSection } from "../../../ui/upstream";

interface WebhookRow {
  id: string;
  url: string;
  status: "active" | "disabled";
  failureCount: number;
}

interface WebhookDeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: "succeeded" | "failed" | "retrying";
  httpStatus: number | null;
  durationMs: number | null;
  responseSnippet: string | null;
  error: string | null;
  createdAt: string;
}

export interface WebhookDeliveriesPanelProps {
  workspaceId: string;
  webhookId: string;
  disabled?: boolean;
}

/**
 * Webhook delivery log inspector with Test, single Replay, and Replay Failed actions (#330).
 */
export function WebhookDeliveriesPanel({
  workspaceId,
  webhookId,
  disabled,
}: WebhookDeliveriesPanelProps) {
  const { t } = useTranslation("quills");
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeliveries = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/webhooks/${encodeURIComponent(webhookId)}/deliveries?limit=25`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { deliveries: WebhookDeliveryRow[] };
      setDeliveries(data.deliveries);
      setLoaded(true);
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/webhooks/${encodeURIComponent(webhookId)}/test`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDeliveries();
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  const replayOne = async (deliveryId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/webhooks/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDeliveries();
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  const replayFailed = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/webhooks/${encodeURIComponent(webhookId)}/deliveries/replay-failed`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadDeliveries();
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void loadDeliveries()}
        >
          {loaded
            ? t("settings-connections.api.webhooks.refresh")
            : t("settings-connections.api.webhooks.viewDeliveries")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void sendTest()}
        >
          {t("settings-connections.api.webhooks.sendTest")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void replayFailed()}
        >
          {t("settings-connections.api.webhooks.replayFailed")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {loaded ? (
        deliveries.length === 0 ? (
          <p className="text-muted-foreground">
            {t("settings-connections.api.webhooks.emptyDeliveries")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <span className="font-medium">{d.eventType}</span>{" "}
                  <span className="text-muted-foreground">
                    · {d.status}
                    {d.httpStatus ? ` (HTTP ${d.httpStatus})` : ""}
                    {d.durationMs !== null ? ` · ${d.durationMs}ms` : ""}
                  </span>
                  {d.error ? (
                    <p className="truncate text-destructive">{d.error}</p>
                  ) : null}
                </div>
                {d.eventType !== "webhook.test" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled || busy}
                    onClick={() => void replayOne(d.id)}
                  >
                    {t("settings-connections.api.webhooks.replay")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function WebhookDeliveriesSection({
  workspaceId,
  disabled,
}: {
  workspaceId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation("quills");
  const [webhooks, setWebhooks] = useState<WebhookRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWebhooks = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/webhooks`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { webhooks?: WebhookRow[] };
      setWebhooks(data.webhooks ?? []);
    } catch {
      setError(t("core.problem.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={t("settings-connections.api.webhooks.title")}
      description={t("settings-connections.api.webhooks.text")}
    >
      <SettingsCard>
        <div className="space-y-3 p-4">
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {webhooks === null ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void loadWebhooks()}
            >
              {t("settings-connections.api.webhooks.load")}
            </Button>
          ) : webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings-connections.api.webhooks.empty")}
            </p>
          ) : (
            <div className="space-y-3">
              {webhooks.map((hook) => (
                <div key={hook.id} className="space-y-2">
                  <p className="truncate font-mono text-xs text-foreground">
                    {hook.url}
                  </p>
                  <WebhookDeliveriesPanel
                    workspaceId={workspaceId}
                    webhookId={hook.id}
                    disabled={disabled}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
