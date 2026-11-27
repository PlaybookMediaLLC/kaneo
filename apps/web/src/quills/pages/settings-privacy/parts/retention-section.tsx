import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteRetentionPolicy,
  downloadPrivacyAccessRequest,
  listPrivacyRequests,
  listRetentionPolicies,
  upsertRetentionPolicy,
  type RetentionAction,
  type RetentionChannel,
} from "@/fetchers/quills/privacy";
import { SettingSelect } from "../../../ui/setting-select";
import {
  Button,
  Input,
  SettingsCard,
  SettingsNote,
  SettingsRow,
  SettingsSection,
  toast,
} from "../../../ui/upstream";

export interface RetentionSectionProps {
  workspaceId: string;
  locked: boolean;
}

const CHANNELS: readonly RetentionChannel[] = [
  "all",
  "messenger",
  "email",
  "widget",
  "ticket",
];

function parseDays(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) return null;
  return parsed;
}

/**
 * Settings › Privacy: per-channel retention schedules and compliance receipts log (#329).
 */
export function RetentionSection({
  workspaceId,
  locked,
}: RetentionSectionProps) {
  const { t } = useTranslation("quills");
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState(false);
  const [channel, setChannel] = useState<RetentionChannel>("all");
  const [action, setAction] = useState<RetentionAction>("delete");
  const [closedAfterDays, setClosedAfterDays] = useState("90");
  const [spamAfterDays, setSpamAfterDays] = useState("30");
  const [softDeletedAfterDays, setSoftDeletedAfterDays] = useState("30");
  const [aiLogsAfterDays, setAiLogsAfterDays] = useState("90");

  const policies = useQuery({
    queryKey: ["quills", workspaceId, "privacy", "retention-policies"],
    queryFn: () => listRetentionPolicies(workspaceId),
    enabled: !locked && expanded,
  });

  const requests = useQuery({
    queryKey: ["quills", workspaceId, "privacy", "requests"],
    queryFn: () => listPrivacyRequests(workspaceId),
    enabled: !locked && expanded,
  });

  const savePolicy = useMutation({
    mutationFn: () =>
      upsertRetentionPolicy(workspaceId, {
        channel,
        action,
        closedAfterDays: parseDays(closedAfterDays),
        spamAfterDays: parseDays(spamAfterDays),
        softDeletedAfterDays: parseDays(softDeletedAfterDays),
        aiLogsAfterDays: parseDays(aiLogsAfterDays),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["quills", workspaceId, "privacy", "retention-policies"],
      });
      toast.success(t("settings-product.privacy.retentionSaved"));
    },
    onError: () => {
      toast.error(t("settings-product.privacy.retentionFailed"));
    },
  });

  const removePolicy = useMutation({
    mutationFn: (policyId: string) =>
      deleteRetentionPolicy(workspaceId, policyId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["quills", workspaceId, "privacy", "retention-policies"],
      });
      toast.success(t("settings-product.privacy.retentionRemoved"));
    },
    onError: () => {
      toast.error(t("settings-product.privacy.retentionFailed"));
    },
  });

  const handleDownload = async (requestId: string) => {
    try {
      const res = await downloadPrivacyAccessRequest(workspaceId, requestId);
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(t("settings-product.privacy.downloadFailed"));
    }
  };

  if (locked) return null;

  if (!expanded) {
    return (
      <SettingsSection title={t("settings-product.privacy.retentionTitle")}>
        <SettingsCard>
          <SettingsRow
            title={t("settings-product.privacy.retentionTitle")}
            description={t("settings-product.privacy.retentionNote")}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded(true)}
            >
              {t("settings-product.privacy.manageRetention")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title={t("settings-product.privacy.retentionTitle")}>
        <SettingsCard>
          <SettingsRow
            title={t("settings-product.privacy.retentionChannel")}
            description={t("settings-product.privacy.retentionChannelText")}
          >
            <SettingSelect
              label={t("settings-product.privacy.retentionChannel")}
              value={channel}
              options={CHANNELS.map((ch) => ({
                value: ch,
                label: t(`settings-product.privacy.channels.${ch}`),
              }))}
              onValueChange={async (value) => {
                setChannel(value as RetentionChannel);
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings-product.privacy.retentionAction")}
            description={t("settings-product.privacy.retentionActionText")}
          >
            <SettingSelect
              label={t("settings-product.privacy.retentionAction")}
              value={action}
              options={[
                {
                  value: "delete",
                  label: t("settings-product.privacy.actions.delete"),
                },
                {
                  value: "anonymize",
                  label: t("settings-product.privacy.actions.anonymize"),
                },
              ]}
              onValueChange={async (value) => {
                setAction(value as RetentionAction);
              }}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings-product.privacy.closedAfterDays")}
            description={t("settings-product.privacy.daysHint")}
          >
            <Input
              type="number"
              min={1}
              max={3650}
              className="w-28"
              value={closedAfterDays}
              onChange={(e) => setClosedAfterDays(e.target.value)}
              aria-label={t("settings-product.privacy.closedAfterDays")}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings-product.privacy.spamAfterDays")}
            description={t("settings-product.privacy.daysHint")}
          >
            <Input
              type="number"
              min={1}
              max={3650}
              className="w-28"
              value={spamAfterDays}
              onChange={(e) => setSpamAfterDays(e.target.value)}
              aria-label={t("settings-product.privacy.spamAfterDays")}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings-product.privacy.softDeletedAfterDays")}
            description={t("settings-product.privacy.daysHint")}
          >
            <Input
              type="number"
              min={1}
              max={3650}
              className="w-28"
              value={softDeletedAfterDays}
              onChange={(e) => setSoftDeletedAfterDays(e.target.value)}
              aria-label={t("settings-product.privacy.softDeletedAfterDays")}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings-product.privacy.aiLogsAfterDays")}
            description={t("settings-product.privacy.daysHint")}
          >
            <Input
              type="number"
              min={1}
              max={3650}
              className="w-28"
              value={aiLogsAfterDays}
              onChange={(e) => setAiLogsAfterDays(e.target.value)}
              aria-label={t("settings-product.privacy.aiLogsAfterDays")}
            />
          </SettingsRow>
          <div className="flex justify-end px-4 py-3">
            <Button
              size="sm"
              disabled={savePolicy.isPending}
              onClick={() => void savePolicy.mutateAsync()}
            >
              {t("settings-product.privacy.saveRetention")}
            </Button>
          </div>
          {(policies.data?.items ?? []).map((policy) => (
            <SettingsRow
              key={policy.id}
              title={t(`settings-product.privacy.channels.${policy.channel}`)}
              description={t("settings-product.privacy.policySummary", {
                action: t(`settings-product.privacy.actions.${policy.action}`),
                closed: policy.closedAfterDays ?? "∞",
                spam: policy.spamAfterDays ?? "∞",
                aiLogs: policy.aiLogsAfterDays ?? "∞",
              })}
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={removePolicy.isPending}
                onClick={() => void removePolicy.mutateAsync(policy.id)}
                aria-label={t("settings-product.privacy.removePolicy")}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </SettingsRow>
          ))}
        </SettingsCard>
        <SettingsNote>
          {t("settings-product.privacy.retentionNote")}
        </SettingsNote>
      </SettingsSection>

      <SettingsSection title={t("settings-product.privacy.requestsTitle")}>
        <SettingsCard>
          {(requests.data?.items ?? []).length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              {t("settings-product.privacy.noRequests")}
            </div>
          ) : (
            (requests.data?.items ?? []).map((req) => (
              <SettingsRow
                key={req.id}
                title={t(`settings-product.privacy.requestTypes.${req.type}`)}
                description={t("settings-product.privacy.requestMeta", {
                  status: req.status,
                  date: new Date(req.createdAt).toLocaleDateString(),
                  conversations: req.summary.conversations ?? 0,
                  files: req.summary.files ?? 0,
                })}
              >
                {req.type === "access" && req.status === "completed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDownload(req.id)}
                  >
                    <Download className="me-1.5 size-3.5" aria-hidden="true" />
                    {t("settings-product.privacy.downloadExport")}
                  </Button>
                ) : null}
              </SettingsRow>
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
