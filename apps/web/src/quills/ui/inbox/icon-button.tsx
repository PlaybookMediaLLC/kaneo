import type { ComponentProps } from "react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "../upstream";

export interface IconButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "aria-label"
> {
  /** The accessible name. The tooltip shows the same text. */
  label: string;
}

/**
 * An icon-only button with its name in a coss Tooltip. For a menu or popover trigger,
 * render it from the trigger: `<MenuTrigger render={<IconButton label="More" />}>`.
 */
export function IconButton({ label, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            {...props}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
