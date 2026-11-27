import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiOrigin } from "../../../core/api-origin";
import { useTeamRuntime } from "../../../team/runtime";
import { Button, Input } from "../../../ui/upstream";

export interface ForwardParseWarningProps {
  workspaceId: string;
  conversationId: string;
}

/**
 * Shown when a teammate-forwarded email had its original sender address stripped
 * (e.g. Outlook Web) so the agent can set the real customer requester before replying (#325).
 */
export function ForwardParseWarning({
  workspaceId,
  conversationId,
}: ForwardParseWarningProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const updateRequester = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${apiOrigin()}/api/quills/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/requester`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            ...(name.trim() ? { name: name.trim() } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    onSuccess: () => {
      setEmail("");
      setName("");
      void qc.invalidateQueries({ queryKey: ["quills"] });
    },
  });

  return (
    <section
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
    >
      <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t("inbox.forwardParseWarning")}</p>
      </div>
      {team.permissions.update ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim() || updateRequester.isPending) return;
            updateRequester.mutate();
          }}
        >
          <Input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("inbox.requesterEmailPlaceholder")}
            aria-label={t("inbox.requesterEmailPlaceholder")}
          />
          <Input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("inbox.requesterNamePlaceholder")}
            aria-label={t("inbox.requesterNamePlaceholder")}
          />
          {updateRequester.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {t("core.problem.failed")}
            </p>
          ) : null}
          <Button
            type="submit"
            size="xs"
            disabled={!email.trim() || updateRequester.isPending}
          >
            {t("inbox.setRequester")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
