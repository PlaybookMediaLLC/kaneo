import { usePortalRuntime } from "../../portal/runtime";
import { useState } from "react";
import { takeStashedToken } from "../../core/token-stash";
import { usePreviewUnsubscribeToken } from "../../hooks/notifications/use-preview-unsubscribe-token";
import { useProcessUnsubscribeToken } from "../../hooks/notifications/use-process-unsubscribe-token";
import { ConfirmAction } from "../../ui/confirm-action";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
export interface UnsubscribePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function UnsubscribePage(props: UnsubscribePageProps) {
  const { viewer } = usePortalRuntime();
  const tokenScope = [
    props.workspaceId,
    ...Object.entries(props.params)
      .filter(([key]) => key !== "workspaceId")
      .map(([, value]) => value),
    meta.id,
  ].join(":");
  const [token] = useState(() => takeStashedToken(tokenScope));
  const preview = usePreviewUnsubscribeToken(
    { param: { workspace: props.workspaceId }, query: { token: token ?? "" } },
    viewer,
  );
  const process = useProcessUnsubscribeToken(viewer);
  const problem = process.isSuccess
    ? null
    : !token || (preview.data && !preview.data.valid)
      ? { kind: "gone" as const }
      : (process.error ?? preview.error ?? null);

  return (
    <PageFrame
      titleKey="unsubscribe.title"
      token="query"
      tokenScope={tokenScope}
      persistToken={false}
    >
      <StateView
        loading={!process.isSuccess && preview.isLoading}
        problem={problem}
        onRetry={() => {
          if (process.error) process.reset();
          else void preview.refetch();
        }}
      >
        {process.isSuccess ? (
          <ResultCard titleKey="unsubscribe.done" />
        ) : (
          <ConfirmAction
            labelKey="unsubscribe.confirm"
            onConfirm={() =>
              process
                .mutateAsync({
                  param: { workspace: props.workspaceId },
                  json: { token: token ?? "" },
                })
                .then(() => undefined)
            }
          />
        )}
      </StateView>
    </PageFrame>
  );
}
