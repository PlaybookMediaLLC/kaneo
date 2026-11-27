import { ArrowLeft } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateNotificationPreferencesRequest } from "../api/team/update-notification-preferences";
import { useGetNotificationPreferences } from "../hooks/team/use-get-notification-preferences";
import { useUpdateNotificationPreferences } from "../hooks/team/use-update-notification-preferences";
import { IconButton } from "../ui/inbox/icon-button";
import { Label, PopoverTitle, Switch } from "../ui/upstream";
import { DesktopNotifications } from "./desktop-notifications";
import { effective, withCell, type Channel } from "./notification-cells";
import { useTeamRuntime } from "./runtime";
import { TeamStateView } from "./team-state-view";

const TYPES = [
  { type: "post_status_changed", labelKey: "team.notifications.statusChanges" },
  { type: "comment_created", labelKey: "team.notifications.comments" },
] as const;

export interface NotificationSettingsProps {
  workspaceId: string;
  /** Goes back to the activity list. */
  onBack: () => void;
}

/**
 * The settings view of the bell: browser notifications, and the in-app and email switches of
 * the types that Quills sends today. A change saves at once.
 */
export function NotificationSettings({
  workspaceId,
  onBack,
}: NotificationSettingsProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  const team = useTeamRuntime();
  const param = { workspaceId };
  const stored = useGetNotificationPreferences({ param }, team.viewer);
  const update = useUpdateNotificationPreferences(team.viewer);
  const data = stored.data;
  // The switches show a change while it saves. A failed save shows the stored values again.
  const shown = data && {
    ...data,
    ...(update.isPending ? update.variables?.json : undefined),
  };
  const save = (json: UpdateNotificationPreferencesRequest["json"]) =>
    update.mutate({ param, json });
  const rows = (channel: Channel) =>
    TYPES.map(({ type, labelKey }) => ({
      key: `${channel}-${type}`,
      label: t(labelKey),
      checked: shown ? effective(shown, type, channel) : false,
      // Mute stops all email, so the email types wait until it is off.
      disabled: channel === "email" && Boolean(shown?.emailMuted),
      change: (next: boolean) =>
        data && save({ matrix: withCell(data.matrix, type, channel, next) }),
    }));
  const groups = [
    { titleKey: "team.notifications.inApp", rows: rows("inApp") },
    {
      titleKey: "team.notifications.email",
      rows: [
        ...rows("email"),
        {
          key: "email-muted",
          label: t("team.notifications.muteEmail"),
          checked: Boolean(shown?.emailMuted),
          disabled: false,
          change: (next: boolean) => save({ emailMuted: next }),
        },
      ],
    },
    { titleKey: "team.notifications.slackDm", rows: rows("slackDm") },
    { titleKey: "team.notifications.push", rows: rows("push") },
  ];
  const digestFrequency =
    (shown as { digestFrequency?: "off" | "hourly" | "daily" } | undefined)
      ?.digestFrequency ?? "off";
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-1">
        <IconButton
          label={t("team.notifications.back")}
          autoFocus
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </IconButton>
        <PopoverTitle className="text-sm">
          {t("team.notifications.title")}
        </PopoverTitle>
      </div>
      <DesktopNotifications />
      <TeamStateView loading={stored.isLoading} problem={stored.error}>
        {groups.map((group) => (
          <fieldset key={group.titleKey} className="grid gap-1">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              {t(group.titleKey)}
            </legend>
            {group.rows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 py-1">
                <Label
                  htmlFor={id + row.key}
                  className="min-w-0 flex-1 font-normal"
                >
                  {row.label}
                </Label>
                <Switch
                  id={id + row.key}
                  checked={row.checked}
                  disabled={update.isPending || row.disabled}
                  onCheckedChange={(next) => void row.change(next)}
                />
              </div>
            ))}
          </fieldset>
        ))}
        <div className="grid gap-1.5">
          <Label
            htmlFor={`${id}-digest`}
            className="text-xs font-medium text-muted-foreground"
          >
            {t("team.notifications.digest")}
          </Label>
          <select
            id={`${id}-digest`}
            value={digestFrequency}
            disabled={update.isPending || Boolean(shown?.emailMuted)}
            onChange={(e) =>
              save({
                digestFrequency: e.target.value as "off" | "hourly" | "daily",
              })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            <option value="off">{t("team.notifications.digestOff")}</option>
            <option value="hourly">
              {t("team.notifications.digestHourly")}
            </option>
            <option value="daily">{t("team.notifications.digestDaily")}</option>
          </select>
        </div>
        {update.isError ? (
          <p role="alert" className="text-xs text-destructive-foreground">
            {t("team.notifications.saveFailed")}
          </p>
        ) : null}
      </TeamStateView>
    </div>
  );
}
