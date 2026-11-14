import type { ReactNode } from "react";

export interface PropertyRowProps {
  label: string;
  /** The value or the control that changes it, such as a select. */
  children: ReactNode;
}

/** One labelled property of the properties panel, such as Status or Assignee. */
export function PropertyRow({ label, children }: PropertyRowProps) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </dl>
  );
}
