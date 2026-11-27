import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiOrigin } from "../../core/api-origin";
import { Button, Textarea } from "../../ui/upstream";

interface MagicLinkMessage {
  id: string;
  fromVisitor: boolean;
  senderType: string;
  authorName: string | null;
  content: string;
  attachments: {
    fileId: string | null;
    name: string;
    contentType: string;
    size: number;
    inline?: boolean;
    downloadPath: string | null;
  }[];
  createdAt: string;
}

interface MagicLinkResponse {
  workspaceName: string;
  conversation: {
    id: string;
    subject: string | null;
    status: string;
    createdAt: string;
    updatedAt: string | null;
  };
  messages: MagicLinkMessage[];
}

export interface MagicLinkRequestPageProps {
  workspaceId: string;
  token: string;
}

export function MagicLinkRequestPage({
  workspaceId,
  token,
}: MagicLinkRequestPageProps) {
  const { t } = useTranslation("quills");
  const qc = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const endpoint = `${apiOrigin()}/api/quills-public/${encodeURIComponent(workspaceId)}/request-link/${encodeURIComponent(token)}`;

  const query = useQuery<MagicLinkResponse>({
    queryKey: ["quills", "magic-link-request", workspaceId, token],
    retry: false,
    queryFn: async () => {
      const res = await fetch(endpoint, { credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });

  const sendReply = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`${endpoint}/reply`, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      void qc.invalidateQueries({
        queryKey: ["quills", "magic-link-request", workspaceId, token],
      });
    },
  });

  if (query.isLoading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-muted-foreground">{t("core.loading")}</p>
      </main>
    );
  }

  if (query.isError || !query.data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">
          {t("core.magicLink.expiredTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("core.magicLink.expiredDescription")}
        </p>
      </main>
    );
  }

  const { workspaceName, conversation, messages } = query.data;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="border-b pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {workspaceName}
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          {conversation.subject ?? t("core.magicLink.defaultSubject")}
        </h1>
      </header>

      <ol className="flex flex-col gap-4">
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.fromVisitor
                ? "ml-8 rounded-lg border bg-muted/40 p-4"
                : "mr-8 rounded-lg border bg-card p-4"
            }
          >
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.fromVisitor
                  ? t("core.magicLink.you")
                  : (message.authorName ?? workspaceName)}
              </span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
            {message.attachments.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {message.attachments.map((att, idx) =>
                  att.downloadPath ? (
                    <li key={att.fileId ?? idx}>
                      {att.contentType.startsWith("image/") ? (
                        <a
                          href={`${apiOrigin()}${att.downloadPath}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={`${apiOrigin()}${att.downloadPath}`}
                            alt={att.name}
                            referrerPolicy="no-referrer"
                            className="max-h-64 rounded border object-contain"
                          />
                        </a>
                      ) : (
                        <a
                          href={`${apiOrigin()}${att.downloadPath}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          <Paperclip className="size-3.5" aria-hidden />
                          <span>{att.name}</span>
                        </a>
                      )}
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <form
        className="flex flex-col gap-2 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = replyText.trim();
          if (!trimmed || sendReply.isPending) return;
          sendReply.mutate(trimmed);
        }}
      >
        <Textarea
          value={replyText}
          onChange={(event) => setReplyText(event.target.value)}
          placeholder={t("core.magicLink.replyPlaceholder")}
          aria-label={t("core.magicLink.replyPlaceholder")}
          rows={3}
        />
        {sendReply.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {t("core.problem.failed")}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={!replyText.trim() || sendReply.isPending}
          >
            <Send className="size-3.5" aria-hidden />
            {t("core.magicLink.sendReply")}
          </Button>
        </div>
      </form>
    </main>
  );
}
