import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../../core/relative-time";
import { teamHref } from "../../../team/team-href";
import { PropertyRow } from "../../../ui/inbox/property-row";
import type { Signal } from "./signal-detail";

export interface SignalPropertiesProps {
  workspaceId: string;
  signal: Signal;
}

const statusKeys = {
  pending: "autopilot.pending",
  accepted: "autopilot.accepted",
  dismissed: "autopilot.dismissed",
} as const;

/** The properties panel of a signal: its status, where it came from and when. */
export function SignalProperties({
  workspaceId,
  signal,
}: SignalPropertiesProps) {
  const { t, i18n } = useTranslation("quills");
  const { source } = signal;
  const place =
    source.type === "conversation"
      ? source.title
        ? t("autopilot.conversationTitle", { title: source.title })
        : t("autopilot.conversation")
      : source.title
        ? t("autopilot.ticketTitle", {
            number: source.number,
            title: source.title,
          })
        : t("autopilot.ticket", { number: source.number });
  return (
    <div>
      <PropertyRow label={t("autopilot.status")}>
        {t(statusKeys[signal.status])}
      </PropertyRow>
      <PropertyRow label={t("autopilot.source")}>
        {/* The conversation and ticket pages of the teammate app (RFC 0004). */}
        <Link
          to={teamHref(
            workspaceId,
            `/${source.type}s/${encodeURIComponent(source.id)}`,
          )}
          className="underline-offset-4 hover:underline"
        >
          {place}
        </Link>
      </PropertyRow>
      <PropertyRow label={t("autopilot.found")}>
        <time dateTime={signal.createdAt}>
          {relativeTime(signal.createdAt, i18n.language)}
        </time>
      </PropertyRow>
    </div>
  );
}
