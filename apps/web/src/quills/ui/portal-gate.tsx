import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Audience } from "../core/types";
import { portalHref } from "../core/portal-href";
import { Button, getSafeRedirectPath } from "./upstream";

export interface PortalGateProps {
  workspaceId: string;
  audience: Audience;
  portalEnabled: boolean;
  accessGranted: boolean;
  signedIn: boolean;
  currentPath?: string;
  children: ReactNode;
}

export function PortalGate(props: PortalGateProps) {
  const { t } = useTranslation("quills");
  if (!props.portalEnabled) return <p role="status">{t("core.portalOff")}</p>;
  if (
    !props.signedIn &&
    (props.audience === "signed-in" ||
      (props.audience !== "public" && !props.accessGranted))
  ) {
    const redirect =
      getSafeRedirectPath(props.currentPath) ?? portalHref(props.workspaceId);
    return (
      <div role="status">
        <p>{t("core.signInRequired")}</p>
        <Button
          render={
            <a
              href={`/auth/sign-in?redirect=${encodeURIComponent(redirect)}`}
            />
          }
        >
          {t("core.signIn")}
        </Button>
      </div>
    );
  }
  if (props.audience !== "public" && !props.accessGranted) {
    return <p role="status">{t("core.noAccess")}</p>;
  }
  return props.children;
}
