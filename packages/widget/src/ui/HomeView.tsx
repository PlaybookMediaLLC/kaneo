import { AvatarSetting } from "./AvatarSetting.js";
import type { ReactNode } from "react";
import { Avatar } from "./Avatar.js";
import { Icon } from "./Icon.js";
import { PortalLink } from "./PortalLink.js";
import { UpdateCard } from "./UpdateCard.js";
import type {
  UpdateEntry,
  WidgetTab,
  Conversation,
  WidgetViewProps,
} from "./types.js";
import type { MessageKey } from "./i18n/messages/en.js";
import { useT } from "./i18n/useT.js";

const REPLY_TIME = {
  minutes: "Usually replies in minutes.",
  hours: "Usually replies in a few hours.",
  day: "Usually replies within a day.",
} as const satisfies Record<string, MessageKey>;

export function HomeView({
  latest,
  navigate,
  compose,
  has = () => true,
  openUpdate,
  conversations,
  openConversation,
  teamAvailability,
  team,
  replyTime,
  greeting,
  survey,
  openPortal,
  changeAvatar,
}: {
  latest?: UpdateEntry;
  navigate: (tab: WidgetTab) => void;
  compose: (kind: "message" | "feedback") => void;
  /** Whether the workspace turned a tab on: Home links only to those. */
  has?: (tab: WidgetTab) => boolean;
  openUpdate: (id: string) => void;
  conversations: readonly Conversation[];
  openConversation: (id: string) => void;
  teamAvailability?: string;
  team?: WidgetViewProps["team"];
  replyTime?: WidgetViewProps["replyTime"];
  greeting?: WidgetViewProps["greeting"];
  /** A waiting survey, shown under the greeting. */
  survey?: ReactNode;
  /** Mails a portal sign-in link; only for a visitor that the host app identified. */
  openPortal?: WidgetViewProps["onOpenPortal"];
  /** Changes the identified visitor's picture. */
  changeAvatar?: WidgetViewProps["onChangeAvatar"];
}) {
  const t = useT();
  const recent = has("messages")
    ? (conversations.find((item) => (item.unreadCount ?? 0) > 0) ??
      conversations[conversations.length - 1])
    : undefined;
  return (
    <div className={`qb-home${recent ? " qb-home-returning" : ""}`}>
      <h1>
        {greeting?.title ?? (
          <>
            {t("Hi there")} <span className="qb-wave">👋</span>
          </>
        )}
        <span>{greeting?.subtitle ?? t("How can we help?")}</span>
      </h1>
      {survey}
      {recent && (
        <button
          type="button"
          className="qb-resume"
          onClick={() => openConversation(recent.id)}
        >
          <Icon name="messages" />
          <span>
            <strong>
              {(recent.unreadCount ?? 0) > 0
                ? t("You have a new reply")
                : t("Continue your conversation")}
            </strong>
            <small>{recent.title}</small>
          </span>
          <Icon name="chevron" />
        </button>
      )}
      {has("messages") && (
        <div className="qb-contact-card">
          <span className="qb-team">
            {team?.avatars.length ? (
              <span className="qb-team-avatars">
                {team.avatars.map((person) => (
                  <Avatar key={person.name} {...person} />
                ))}
              </span>
            ) : (
              <span className="qb-avatar qb-team-avatar">
                <Icon name="messages" />
              </span>
            )}
            {team?.online && (
              <span className="qb-online-dot" aria-hidden="true" />
            )}
          </span>
          <h2>{t("Send us a message")}</h2>
          <p>
            {teamAvailability ??
              ([
                team?.online ? t("We’re online now.") : "",
                !team?.online &&
                team?.withinOfficeHours === false &&
                team.nextOpenAt &&
                !Number.isNaN(new Date(team.nextOpenAt).getTime())
                  ? `Back online ${new Date(team.nextOpenAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
                  : team?.waitEstimateLabel
                    ? `Usually replies in ${team.waitEstimateLabel}.`
                    : replyTime
                      ? t(REPLY_TIME[replyTime])
                      : "",
              ]
                .filter(Boolean)
                .join(" ") ||
                t("Ask a question or share what you need."))}
          </p>
          <button
            type="button"
            className="qb-message-prompt"
            onClick={() => compose("message")}
          >
            <span>{t("Write a message…")}</span>
            <span className="qb-send-icon">
              <Icon name="arrow" />
            </span>
          </button>
        </div>
      )}
      {has("help") && (
        <button
          type="button"
          className="qb-quick-link"
          onClick={() => navigate("help")}
        >
          <Icon name="support" weight="fill" />
          <span>{t("Search for help")}</span>
          <Icon name="chevron" />
        </button>
      )}
      {has("feedback") && (
        <button
          type="button"
          className="qb-quick-link"
          onClick={() => compose("feedback")}
        >
          <Icon name="inbox" weight="fill" />
          <span>{t("Submit a request")}</span>
          <Icon name="chevron" />
        </button>
      )}
      {openPortal && <PortalLink send={openPortal} />}
      {changeAvatar && <AvatarSetting change={changeAvatar} />}
      {latest && has("updates") && (
        <section className="qb-latest">
          <div className="qb-section-label">
            <span>
              <Icon name="updates" />
              {latest.unread ? t("New update") : t("Latest update")}
            </span>
            <button type="button" onClick={() => navigate("updates")}>
              {t("See all")} <Icon name="chevron" />
            </button>
          </div>
          <UpdateCard entry={latest} onOpen={() => openUpdate(latest.id)} />
        </section>
      )}
    </div>
  );
}
