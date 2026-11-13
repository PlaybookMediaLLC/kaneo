import { useContext, type ComponentProps } from "react";
import { PortalThemeContext } from "../core/portal-theme-context";
import { SheetContent } from "./upstream";

export type PortalSheetContentProps = ComponentProps<typeof SheetContent>;

export function PortalSheetContent({
  style,
  ...props
}: PortalSheetContentProps) {
  const theme = useContext(PortalThemeContext);
  // quills-web-allow C19: Sheets render outside PortalShell and must carry its scoped workspace theme.
  return <SheetContent style={{ ...theme, ...style }} {...props} />;
}
