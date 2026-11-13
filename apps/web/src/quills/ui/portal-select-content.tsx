import { useContext, type ComponentProps } from "react";
import { PortalThemeContext } from "../core/portal-theme-context";
import { SelectContent } from "./upstream";

export type PortalSelectContentProps = ComponentProps<typeof SelectContent>;

export function PortalSelectContent({
  style,
  ...props
}: PortalSelectContentProps) {
  const theme = useContext(PortalThemeContext);
  // quills-web-allow C19: Popups render outside PortalShell and must carry its scoped workspace theme.
  return <SelectContent style={{ ...theme, ...style }} {...props} />;
}
