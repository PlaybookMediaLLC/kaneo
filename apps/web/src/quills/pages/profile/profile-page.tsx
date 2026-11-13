import type { PortalProblem } from "../../core/types";
import { portalHref } from "../../core/portal-href";
import { useGetCustomerProfile } from "../../hooks/portal/use-get-customer-profile";
import { useGetPublicUserProfile } from "../../hooks/portal/use-get-public-user-profile";
import { useUpdateCustomerProfile } from "../../hooks/portal/use-update-customer-profile";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { ProfileForm } from "./parts/profile-form";
import { ProfileSummary } from "./parts/profile-summary";

export interface ProfilePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function ProfilePage(props: ProfilePageProps) {
  const portal = usePortalRuntime();
  const canLoad =
    !portal.accessLoading &&
    portal.access?.granted === true &&
    portal.viewer.kind === "user";
  const account = useGetCustomerProfile(
    { param: { workspace: canLoad ? props.workspaceId : "" } },
    portal.viewer,
  );
  const publicProfile = useGetPublicUserProfile(
    {
      param: {
        workspace: canLoad ? props.workspaceId : "",
        principalId: account.data?.principalId ?? "",
      },
    },
    portal.viewer,
  );
  const update = useUpdateCustomerProfile(portal.viewer);
  const updateProfile = async (values: {
    name: string;
  }): Promise<PortalProblem | void> => {
    try {
      await update.mutateAsync({
        param: { workspace: props.workspaceId },
        json: values,
      });
    } catch (error) {
      return error as PortalProblem;
    }
  };
  const publicProblem =
    publicProfile.error?.kind === "notFound" ? null : publicProfile.error;
  const problem = account.error ?? publicProblem ?? null;
  const retry = problem
    ? () => {
        void account.refetch();
        if (account.data?.principalId) void publicProfile.refetch();
      }
    : undefined;

  return (
    <PageFrame
      titleKey="profile.title"
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
          currentPath={portalHref(props.workspaceId, "profile")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={
              account.isLoading ||
              (Boolean(account.data?.principalId) && publicProfile.isLoading)
            }
            problem={problem}
            onRetry={retry}
          >
            {account.data ? (
              <>
                <ProfileSummary
                  account={account.data}
                  publicProfile={publicProfile.data}
                />
                <ProfileForm
                  initialName={account.data.name}
                  onSubmit={updateProfile}
                />
              </>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
