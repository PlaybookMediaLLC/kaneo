import type { LucideIcon } from "lucide-react";

/** A customer, author or teammate in an inbox part. */
export interface InboxPerson {
  name: string | null;
  avatarUrl?: string | null;
}

/** A small caps badge of a row, such as "Resolved" or "Stale 6mo". */
export interface InboxBadge {
  id: string;
  label: string;
  tone?: "neutral" | "success" | "warning" | "error" | "info";
}

/** A button of the floating action bar. */
export interface InboxAction {
  id: string;
  label: string;
  /** A single key such as "r". It works only while the action is enabled. */
  shortcut?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

/** A choice of the composer's mode dropdown, such as Reply or Note. */
export interface ComposerMode {
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Tints the box yellow, as for an internal note or a private comment. */
  private?: boolean;
}
