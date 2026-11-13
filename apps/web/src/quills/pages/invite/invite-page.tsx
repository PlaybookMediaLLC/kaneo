import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { takeStashedToken } from "../../core/token-stash";
import { useAcceptPortalInvite } from "../../hooks/portal/use-accept-portal-invite";
import { usePortalRuntime } from "../../portal/runtime";
import { ConfirmAction } from "../../ui/confirm-action";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";
import { Button } from "../../ui/upstream";
import { meta } from "./meta";

export interface InvitePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function InvitePage(props: InvitePageProps) {
  const { t } = useTranslation("quills");
  const { viewer } = usePortalRuntime();
  const inviteId = props.params.inviteId ?? "";
  const tokenScope = `${props.workspaceId}:${inviteId}:${meta.id}`;
  const [token] = useState(() =>
    viewer.kind === "user" ? takeStashedToken(tokenScope) : null,
  );
  const accept = useAcceptPortalInvite(viewer);
  const returnPath = portalHref(
    props.workspaceId,
    `invite/${encodeURIComponent(inviteId)}`,
  );
  const problem = accept.isSuccess
    ? null
    : !token && viewer.kind === "user"
      ? { kind: "gone" as const }
      : accept.error;

  return (
    <PageFrame
      persistToken
      titleKey="invite.title"
      token="fragment"
      tokenScope={tokenScope}
    >
      {viewer.kind === "anonymous" ? (
        <div className="space-y-4">
          <p>{t("invite.signInHelp")}</p>
          <Button
            render={
              <a
                href={`/auth/sign-in?redirect=${encodeURIComponent(returnPath)}`}
              />
            }
          >
            {t("core.signIn")}
          </Button>
        </div>
      ) : (
        <StateView
          loading={accept.isPending}
          problem={problem}
          onRetry={() => accept.reset()}
        >
          {accept.isSuccess ? (
            <ResultCard
              titleKey={
                accept.data.alreadyAccepted
                  ? "invite.alreadyAccepted"
                  : "invite.done"
              }
            />
          ) : (
            <ConfirmAction
              labelKey="invite.accept"
              onConfirm={() =>
                accept
                  .mutateAsync({
                    param: { workspace: props.workspaceId, inviteId },
                    json: { token: token ?? "" },
                  })
                  .then(() => undefined)
              }
            />
          )}
        </StateView>
      )}
    </PageFrame>
  );
}
