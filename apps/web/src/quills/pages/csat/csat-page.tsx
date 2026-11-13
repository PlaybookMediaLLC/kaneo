import { useState } from "react";
import { useTranslation } from "react-i18next";
import { takeStashedToken } from "../../core/token-stash";
import { useRecordCsatViaToken } from "../../hooks/support/use-record-csat-via-token";
import { useValidateCsatEmailToken } from "../../hooks/support/use-validate-csat-email-token";
import { usePortalRuntime } from "../../portal/runtime";
import { ConfirmAction } from "../../ui/confirm-action";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { RatingScale } from "./parts/rating-scale";

export interface CsatPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function CsatPage(props: CsatPageProps) {
  const { t } = useTranslation("quills");
  const { viewer } = usePortalRuntime();
  const tokenScope = `${props.workspaceId}:${meta.id}`;
  const [token] = useState(() => takeStashedToken(tokenScope));
  const initialRating =
    typeof props.search.rating === "number" ? props.search.rating : null;
  const [rating, setRating] = useState<number | null>(initialRating);
  const preview = useValidateCsatEmailToken(
    {
      param: { workspace: props.workspaceId },
      query: { token: token ?? "" },
    },
    viewer,
  );
  const record = useRecordCsatViaToken(viewer);
  const completed = record.isSuccess && record.data.recorded;
  const problem = completed
    ? null
    : !token ||
        (preview.data && !preview.data.valid) ||
        (record.isSuccess && !record.data.recorded)
      ? { kind: "gone" as const }
      : (record.error ?? preview.error ?? null);

  return (
    <PageFrame
      persistToken={false}
      titleKey="csat.title"
      token="query"
      tokenScope={tokenScope}
    >
      <StateView
        loading={!record.isSuccess && preview.isLoading}
        problem={problem}
        onRetry={() => {
          if (record.error) record.reset();
          else void preview.refetch();
        }}
      >
        {completed ? (
          <ResultCard titleKey="csat.done">
            <p>{t("csat.recordedRating", { rating: record.data.rating })}</p>
          </ResultCard>
        ) : (
          <div className="space-y-6">
            <RatingScale onChange={setRating} value={rating} />
            <ConfirmAction
              disabled={rating === null}
              labelKey="csat.confirm"
              onConfirm={() =>
                record
                  .mutateAsync({
                    param: { workspace: props.workspaceId },
                    json: { token: token ?? "", rating: rating ?? 1 },
                  })
                  .then(() => undefined)
              }
            />
          </div>
        )}
      </StateView>
    </PageFrame>
  );
}
