import { useEffect, type ReactNode } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { portalReturnPath } from "../core/portal-return-path";
import { portalSignInHref } from "../core/portal-sign-in-href";
import { readerLocale } from "../core/reader-locale";
import { directionOf } from "../core/text-direction";
import { portalHref } from "../core/portal-href";
import { navOf } from "../core/portal-nav";
import { PortalNavigation } from "../ui/portal-navigation";
import type { PortalBranding } from "../core/types";
import { usePortalViewer } from "../core/use-portal-viewer";
import { useEvaluateMyPortalAccess } from "../hooks/portal/use-evaluate-my-portal-access";
import { useGetMyLanguagePreference } from "../hooks/portal/use-get-my-language-preference";
import { useGetPublicPortalConfig } from "../hooks/portal/use-get-public-portal-config";
import { PortalShell } from "../ui/portal-shell";
import { StateView } from "../ui/state-view";
import { PortalAccountMenu } from "./portal-account-menu";
import { PortalSearch } from "./portal-search";
import { PortalWidgetLink } from "./widget-link";
import { PortalRuntimeProvider } from "./runtime";
import { usePortalRealtime } from "./use-portal-realtime";

export interface PortalLayoutProps {
  workspaceName: string;
  branding: PortalBranding;
  children: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
}

export function PortalLayout({
  workspaceName,
  branding,
  children,
  actions,
  navigation,
}: PortalLayoutProps) {
  return (
    <PortalShell
      workspaceName={workspaceName}
      branding={branding}
      actions={actions}
      navigation={navigation}
    >
      {children}
    </PortalShell>
  );
}

export function PortalRoute() {
  const { t } = useTranslation("quills");
  const navigate = useNavigate();
  const currentPath = useLocation({ select: (location) => location.href });
  const params = useParams({ strict: false });
  const workspaceId = String(params.workspaceId);
  const viewer = usePortalViewer();
  const input = { param: { workspace: workspaceId } };
  const config = useGetPublicPortalConfig(input, viewer);
  const access = useEvaluateMyPortalAccess(input, viewer);
  // A signed-in customer's saved language: translations and changelog versions follow it.
  const language = useGetMyLanguagePreference(
    { param: { workspace: viewer.kind === "user" ? workspaceId : "" } },
    viewer,
  );
  // A right-to-left reader gets a right-to-left portal (issue #117); the page goes back on leaving.
  const direction = directionOf(readerLocale(language.data?.language));
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("dir");
    root.setAttribute("dir", direction);
    return () => {
      if (previous === null) root.removeAttribute("dir");
      else root.setAttribute("dir", previous);
    };
  }, [direction]);
  // The portal pages read the nav from the runtime, so this one fallback covers them all.
  const nav = navOf(config.data?.nav);
  const basePath = currentPath.split(/[?#]/)[0]!;
  const section =
    basePath.slice(portalHref(workspaceId).length).split("/")[1] ?? "";
  const isSupportSection = ["support", "conversations", "tickets"].includes(
    section,
  );
  usePortalRealtime(
    workspaceId,
    viewer,
    viewer.kind === "user" && isSupportSection,
  );
  const signInHref = portalSignInHref(
    workspaceId,
    portalReturnPath(currentPath),
    access.data?.signIn,
  );
  // A token sign-in that could not finish lands here (gaps G-17 and G-24).
  const signInNotice = new URLSearchParams(currentPath.split("?")[1] ?? "")
    .get("signIn")
    ?.replace(/[^a-z]/g, "");
  // Small screens have no room for the header action, so feedback pages float it at the bottom.
  const floatSubmit =
    nav.tabs.feedback &&
    ["", "boards", "posts", "roadmap", "changelog"].includes(section);

  // Mail links must open while the portal is off: the token pages need only the link's token, and
  // the status page has its own publish switch (its API applies the private-portal gate).
  if (
    config.error?.kind === "notFound" &&
    ["unsubscribe", "csat", "status"].includes(section)
  )
    return <Outlet />;

  return (
    <StateView
      loading={config.isLoading}
      problem={config.error ?? null}
      onRetry={() => void config.refetch()}
    >
      {config.data ? (
        <DirectionProvider direction={direction}>
          <PortalRuntimeProvider
            value={{
              config: { ...config.data, nav },
              viewer,
              access: access.data ?? null,
              accessLoading: access.isLoading,
              accessProblem: access.error ?? null,
              retryAccess: () => void access.refetch(),
              savedLanguage: language.data?.language ?? null,
            }}
          >
            <PortalLayout
              workspaceName={config.data.name}
              branding={config.data.branding}
              navigation={
                <PortalNavigation
                  workspaceId={workspaceId}
                  currentPath={basePath}
                  nav={nav}
                  onNavigate={(href) => void navigate({ href })}
                />
              }
              actions={
                <>
                  <PortalSearch workspaceId={workspaceId} />
                  {viewer.kind === "user" ? (
                    <PortalAccountMenu workspaceId={workspaceId} />
                  ) : signInHref ? (
                    <a
                      className="bg-muted text-foreground hover:bg-muted/70"
                      href={signInHref}
                    >
                      {t("core.signIn")}
                    </a>
                  ) : null}
                  <Link
                    className="hidden bg-primary text-primary-foreground hover:bg-primary/90 sm:inline-flex"
                    to={portalHref(workspaceId)}
                    search={{ openFeedback: 1 }}
                  >
                    {t("feedback.submit")}
                  </Link>
                </>
              }
            >
              {viewer.kind === "user" ? (
                <PortalWidgetLink
                  workspaceId={workspaceId}
                  workspaceName={config.data.name}
                />
              ) : null}
              {signInNotice ? (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                  {signInNotice === "required"
                    ? t("core.signInWithAccount")
                    : t("core.signInLinkFailed")}
                </p>
              ) : null}
              <Outlet />
              {floatSubmit ? (
                <Link
                  className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto w-fit rounded-full bg-primary px-5 py-3 font-medium text-primary-foreground shadow-lg outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:hidden"
                  to={portalHref(workspaceId)}
                  search={{ openFeedback: 1 }}
                >
                  {t("feedback.submit")}
                </Link>
              ) : null}
            </PortalLayout>
          </PortalRuntimeProvider>
        </DirectionProvider>
      ) : null}
    </StateView>
  );
}
