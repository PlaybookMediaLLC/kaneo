import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StateView, type StateViewProps } from "../ui/state-view";
import { Alert, AlertDescription, handleUnauthorized } from "../ui/upstream";

// The teammate API decides access (RFC 0003 D2). A 401 starts the sign-in
// redirect and a 403 shows the denied state. A hidden control is never the check.
export function TeamStateView(props: StateViewProps) {
  const { t } = useTranslation("quills");
  const kind = props.problem?.kind;
  useEffect(() => {
    if (kind === "authRequired") handleUnauthorized();
  }, [kind]);
  if (!props.loading && kind === "noAccess")
    return (
      <Alert role="alert">
        <AlertDescription className="text-foreground">
          {t("team.denied")}
        </AlertDescription>
      </Alert>
    );
  return <StateView {...props} />;
}
