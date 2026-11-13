import type { PortalProblem } from "../../core/types";
import { portalHref } from "../../core/portal-href";
import { useGetMyChangelogSubscription } from "../../hooks/portal/use-get-my-changelog-subscription";
import { useGetMyLanguagePreference } from "../../hooks/portal/use-get-my-language-preference";
import { useGetMyStatusSubscription } from "../../hooks/portal/use-get-my-status-subscription";
import { useSetMyLanguagePreference } from "../../hooks/portal/use-set-my-language-preference";
import { useSubscribeMyChangelog } from "../../hooks/portal/use-subscribe-my-changelog";
import { useSubscribeStatus } from "../../hooks/portal/use-subscribe-status";
import { useUnsubscribeMyChangelog } from "../../hooks/portal/use-unsubscribe-my-changelog";
import { useUnsubscribeStatus } from "../../hooks/portal/use-unsubscribe-status";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { LanguagePreferenceForm } from "./parts/language-preference-form";
import { PreferenceToggle } from "./parts/preference-toggle";

export interface PreferencesPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function PreferencesPage(props: PreferencesPageProps) {
  const portal = usePortalRuntime();
  const workspace =
    !portal.accessLoading &&
    portal.access?.granted &&
    portal.viewer.kind === "user"
      ? props.workspaceId
      : "";
  const input = { param: { workspace } };
  const language = useGetMyLanguagePreference(input, portal.viewer);
  const changelog = useGetMyChangelogSubscription(input, portal.viewer);
  const status = useGetMyStatusSubscription(input, portal.viewer);
  const setLanguage = useSetMyLanguagePreference(portal.viewer);
  const subscribeChangelog = useSubscribeMyChangelog(portal.viewer);
  const unsubscribeChangelog = useUnsubscribeMyChangelog(portal.viewer);
  const subscribeStatus = useSubscribeStatus(portal.viewer);
  const unsubscribeStatus = useUnsubscribeStatus(portal.viewer);
  const mutations = [
    setLanguage,
    subscribeChangelog,
    unsubscribeChangelog,
    subscribeStatus,
    unsubscribeStatus,
  ];
  const mutationError =
    mutations.find((mutation) => mutation.error)?.error ?? null;
  const problem = language.error ?? changelog.error ?? status.error ?? null;
  const queryError = language.error || changelog.error || status.error;
  const onRetry = queryError
    ? () => {
        void language.refetch();
        void changelog.refetch();
        void status.refetch();
      }
    : undefined;
  const pending = mutations.some((mutation) => mutation.isPending);
  const saveLanguage = async (values: {
    language: string | null;
  }): Promise<PortalProblem | void> => {
    try {
      await setLanguage.mutateAsync({
        param: { workspace: props.workspaceId },
        json: values,
      });
    } catch (error) {
      return error as PortalProblem;
    }
  };
  const changeChangelog = async (checked: boolean) => {
    try {
      await (checked ? subscribeChangelog : unsubscribeChangelog).mutateAsync({
        param: { workspace: props.workspaceId },
      });
    } catch {
      // The mutation state is rendered by StateView and reset explicitly there.
    }
  };
  const changeStatus = async (checked: boolean) => {
    try {
      if (checked) {
        await subscribeStatus.mutateAsync({
          param: { workspace: props.workspaceId },
          json: { scope: "page" },
        });
      } else {
        await unsubscribeStatus.mutateAsync({
          param: { workspace: props.workspaceId },
        });
      }
    } catch {
      // The mutation state is rendered by StateView and reset explicitly there.
    }
  };

  return (
    <PageFrame
      titleKey="preferences.title"
      token="none"
      tokenScope={undefined}
      persistToken
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "preferences")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={
              language.isLoading || changelog.isLoading || status.isLoading
            }
            problem={problem}
            onRetry={onRetry}
          >
            {language.data && changelog.data && status.data ? (
              <>
                <StateView
                  problem={
                    mutationError?.kind === "invalid" ? null : mutationError
                  }
                  onRetry={() =>
                    mutations.forEach((mutation) => mutation.reset())
                  }
                >
                  {null}
                </StateView>
                <LanguagePreferenceForm
                  initialLanguage={language.data.language}
                  onSubmit={saveLanguage}
                />
                <PreferenceToggle
                  labelKey="preferences.changelog"
                  checked={changelog.data.subscribed}
                  disabled={pending || Boolean(mutationError)}
                  onChange={changeChangelog}
                />
                <PreferenceToggle
                  labelKey="preferences.status"
                  checked={status.data.subscribed}
                  disabled={pending || Boolean(mutationError)}
                  onChange={changeStatus}
                />
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
