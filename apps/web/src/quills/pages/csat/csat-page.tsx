import { useState } from "react";
import { useTranslation } from "react-i18next";
import { takeStashedToken } from "../../core/token-stash";
import { useRecordCsatViaToken } from "../../hooks/support/use-record-csat-via-token";
import { useValidateCsatEmailToken } from "../../hooks/support/use-validate-csat-email-token";
import { usePortalViewer } from "../../core/use-portal-viewer";
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
  // The portal runtime is missing while the portal is off (portal/layout.tsx).
  const viewer = usePortalViewer();
  const tokenScope = `${props.workspaceId}:${meta.id}`;
  const [token] = useState(() => takeStashedToken(tokenScope));
  const initialRating =
    typeof props.search.rating === "number" ? props.search.rating : null;
  const [rating, setRating] = useState<number | null>(initialRating);
  const [comment, setComment] = useState("");
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
            <div className="space-y-1.5">
              <label
                htmlFor="csat-comment"
                className="block text-sm font-medium text-foreground"
              >
                {t("csat.commentLabel")}
              </label>
              <textarea
                id="csat-comment"
                rows={3}
                maxLength={2000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("csat.commentPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <ConfirmAction
              disabled={rating === null}
              labelKey="csat.confirm"
              onConfirm={() => {
                const trimmed = comment.trim();
                return record
                  .mutateAsync({
                    param: { workspace: props.workspaceId },
                    json: {
                      token: token ?? "",
                      rating: rating ?? 1,
                      ...(trimmed ? { comment: trimmed } : {}),
                    },
                  })
                  .then(() => undefined);
              }}
            />
          </div>
        )}
      </StateView>
    </PageFrame>
  );
}
