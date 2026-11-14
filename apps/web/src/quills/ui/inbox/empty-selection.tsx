import { Inbox, type LucideIcon } from "lucide-react";

export interface EmptySelectionProps {
  /** The illustration icon. */
  icon?: LucideIcon;
  /** Such as "No conversation selected". */
  title: string;
  /** Such as "Open a thread to read and reply." */
  text?: string;
}

/** The main pane while no item is open. */
export function EmptySelection({
  icon: Icon = Inbox,
  title,
  text,
}: EmptySelectionProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="font-medium">{title}</h2>
      {text ? <p className="text-sm text-muted-foreground">{text}</p> : null}
    </div>
  );
}
