import { messageTime } from "./message-time.js";
import { useLocale, useT } from "./i18n/useT.js";

export interface MyRequestItem {
  id: string;
  kind: "post" | "ticket";
  title: string;
  stage: "open" | "planned" | "in_progress" | "shipped" | "closed";
  statusLabel: string;
  role: "authored" | "voted" | "requested";
  releaseVersion: string | null;
  updatedAt: string;
}

export interface MyReleaseUpdate {
  id: string;
  releaseId: string;
  version: string;
  subject: string;
  body: string;
  quotedText: string | null;
  sentAt: string;
}

/**
 * Unified "My requests" timeline for a widget visitor (#298): displays all feedback posts and
 * support tickets the visitor submitted or voted on, along with verified release badges.
 */
export function MyRequestsView({
  items,
  releases = [],
  onOpenPost,
}: {
  items: readonly MyRequestItem[];
  releases?: readonly MyReleaseUpdate[];
  onOpenPost?: (postId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (!items.length && !releases.length) {
    return null;
  }
  return (
    <section className="qb-my-requests" aria-label={t("Request")}>
      {releases.length > 0 && (
        <ul className="qb-activity-list">
          {releases.map((rel) => {
            const stamp = messageTime(rel.sentAt, locale);
            return (
              <li key={rel.id}>
                <div className="qb-activity-open">
                  <span>
                    <strong>{rel.subject}</strong>
                    {rel.quotedText && <span>“{rel.quotedText}”</span>}
                    <span>{rel.version}</span>
                    {stamp && (
                      <time dateTime={stamp.iso}>
                        {stamp.day} · {stamp.time}
                      </time>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && (
        <ul className="qb-activity-list">
          {items.map((item) => {
            const stamp = messageTime(item.updatedAt, locale);
            const content = (
              <span>
                <strong>{item.title}</strong>
                <span>
                  {item.statusLabel}
                  {item.releaseVersion ? ` · ${item.releaseVersion}` : ""}
                </span>
                {stamp && (
                  <time dateTime={stamp.iso}>
                    {stamp.day} · {stamp.time}
                  </time>
                )}
              </span>
            );
            return (
              <li key={`${item.kind}:${item.id}`}>
                {item.kind === "post" && onOpenPost ? (
                  <button
                    type="button"
                    className="qb-activity-open"
                    onClick={() => onOpenPost(item.id)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="qb-activity-open">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
