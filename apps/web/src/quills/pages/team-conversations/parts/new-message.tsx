import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListUsersResponse } from "../../../api/team/list-users";
import { useListUsers } from "../../../hooks/team/use-list-users";
import { useStartAgentConversation } from "../../../hooks/team/use-start-agent-conversation";
import { useTeamRuntime } from "../../../team/runtime";
import { Composer } from "../../../ui/inbox/composer";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { PersonAvatar } from "../../../ui/person-avatar";
import { IconButton } from "../../../ui/inbox/icon-button";
import { useDebouncedValue } from "../../../ui/upstream";

type Customer = ListUsersResponse["items"][number];

export interface NewMessageProps {
  workspaceId: string;
  onClose: () => void;
  /** Runs with the new conversation after the first message is sent. */
  onStarted: (conversationId: string) => void;
}

const field = "min-w-0 flex-1 bg-transparent text-sm outline-none";

/**
 * Starts an email conversation with a customer (design section 2, New message). The API
 * takes no subject, so the card has no Subject field.
 */
export function NewMessage(props: NewMessageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<Customer | null>(null);
  const [text, setText] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const users = useListUsers(
    {
      param: { workspaceId: search && !to ? props.workspaceId : "" },
      query: { search, limit: "8" },
    },
    team.viewer,
  );
  const start = useStartAgentConversation(team.viewer);
  const found = users.data?.items ?? [];
  const send = () => {
    if (!to) return;
    start.mutate(
      {
        param: { workspaceId: props.workspaceId },
        json: { targetPrincipalId: to.principalId, content: text.trim() },
      },
      { onSuccess: (data) => props.onStarted(data.conversation.id) },
    );
  };
  return (
    <section
      aria-labelledby="new-message-title"
      className="flex min-h-0 flex-1 flex-col"
    >
      <DetailHeader onBack={props.onClose}>
        <h2 id="new-message-title" className="font-semibold">
          {t("team-conversations.newMessage.title")}
        </h2>
      </DetailHeader>
      <div className="mx-auto grid w-full max-w-205 flex-1 content-start gap-2 p-4">
        <div className="rounded-2xl border border-border">
          <div className="flex min-h-11 items-center gap-2 px-4 text-sm">
            <span className="text-muted-foreground">
              {t("team-conversations.newMessage.to")}
            </span>
            {to ? (
              <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-muted py-0.5 ps-1 pe-0.5">
                <PersonAvatar colored name={to.name} avatarUrl={to.image} />
                <span className="truncate">{to.name}</span>
                <IconButton
                  size="icon-xs"
                  className="rounded-full"
                  label={t("team-conversations.newMessage.remove", {
                    name: to.name,
                  })}
                  onClick={() => setTo(null)}
                >
                  <X aria-hidden="true" />
                </IconButton>
              </span>
            ) : (
              <input
                type="search"
                aria-label={t("team-conversations.newMessage.to")}
                autoFocus
                autoComplete="off"
                placeholder={t("team-conversations.newMessage.toHint")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={field}
              />
            )}
          </div>
          {to || !search ? null : (
            <ul
              aria-label={t("team-conversations.newMessage.results")}
              className="grid border-t border-border p-1"
            >
              {found.map((customer) => (
                <li key={customer.principalId}>
                  <button
                    type="button"
                    onClick={() => setTo(customer)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PersonAvatar
                      colored
                      name={customer.name}
                      avatarUrl={customer.image}
                    />
                    <span className="truncate">{customer.name}</span>
                    <span className="truncate text-muted-foreground">
                      {customer.email ?? customer.contactEmail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p role="status" className="px-4 empty:hidden">
            {search && !to && users.isSuccess && !found.length
              ? t("team-conversations.newMessage.none")
              : null}
          </p>
        </div>
        {start.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(
              start.error.kind === "conflict"
                ? "team-conversations.newMessage.refused"
                : "team-conversations.problem.failed",
            )}
          </p>
        ) : null}
      </div>
      <div className="mx-auto w-full max-w-205 px-4 pb-4">
        <Composer
          label={t("team-conversations.newMessage.compose")}
          value={text}
          onChange={setText}
          onSend={send}
          sending={start.isPending}
          disabled={!to || !team.permissions.update}
        />
      </div>
    </section>
  );
}
