import { useContext, type ComponentProps } from "react";
import { PortalThemeContext } from "../core/portal-theme-context";
import { DialogPopup } from "./upstream";

export type PortalDialogContentProps = ComponentProps<typeof DialogPopup>;

export function PortalDialogContent({
  style,
  ...props
}: PortalDialogContentProps) {
  const theme = useContext(PortalThemeContext);
  // quills-web-allow C19: Dialogs render outside PortalShell and must carry its scoped workspace theme.
  return <DialogPopup style={{ ...theme, ...style }} {...props} />;
}
