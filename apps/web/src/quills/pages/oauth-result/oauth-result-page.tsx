import { useTranslation } from "react-i18next";
import { PageFrame } from "../../ui/page-frame";
import { ResultCard } from "../../ui/result-card";
import { StateView } from "../../ui/state-view";

const outcomeKeys = {
  connected: "oauth-result.outcome.connected",
  already_used: "oauth-result.outcome.alreadyUsed",
  denied: "oauth-result.outcome.denied",
  unauthorized: "oauth-result.outcome.unauthorized",
  no_access: "oauth-result.outcome.noAccess",
  not_found: "oauth-result.outcome.notFound",
  restart: "oauth-result.outcome.restart",
  failed: "oauth-result.outcome.failed",
} as const;

type OAuthOutcome = keyof typeof outcomeKeys;

export interface OauthResultPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

function outcomeFrom(search: Record<string, unknown>): OAuthOutcome {
  const outcome = search.outcome;
  return typeof outcome === "string" && outcome in outcomeKeys
    ? (outcome as OAuthOutcome)
    : "failed";
}

export function OauthResultPage({ search }: OauthResultPageProps) {
  const { t } = useTranslation("quills");
  const outcome = outcomeFrom(search);
  const failed = !["connected", "already_used"].includes(outcome);

  return (
    <PageFrame titleKey="oauth-result.title">
      <meta name="referrer" content="no-referrer" />
      <StateView loading={false} problem={null}>
        <ResultCard
          titleKey={outcomeKeys[outcome]}
          status={failed ? "failed" : "success"}
        >
          <a href="/">{t("oauth-result.return")}</a>
        </ResultCard>
      </StateView>
    </PageFrame>
  );
}
