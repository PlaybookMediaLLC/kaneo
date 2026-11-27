export { Button } from "@/components/ui/button";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export { Input } from "@/components/ui/input";
export {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
export { Label } from "@/components/ui/label";
export { Textarea } from "@/components/ui/textarea";
export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "@/components/ui/sheet";
export { toast } from "@/lib/toast";
export { HttpError, handleUnauthorized } from "@/lib/http-error";
export { authClient } from "@/lib/auth-client";
export { i18n } from "@/lib/i18n";
export { getSafeRedirectPath } from "@/components/auth/auth-methods";
export { formatDeviceCode } from "@/components/auth/device-code";
export { default as useGetNotifications } from "@/hooks/queries/notification/use-get-notifications";
export { default as Markdown } from "react-markdown";

export {
  Select,
  SelectGroup,
  SelectItem,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export { Switch } from "@/components/ui/switch";
export { Checkbox } from "@/components/ui/checkbox";
export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
export { Fieldset } from "@/components/ui/fieldset";
export { cn } from "@/lib/cn";

export {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
export { Spinner } from "@/components/ui/spinner";

export { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
export {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
export { Kbd } from "@/components/ui/kbd";

export { useDebouncedValue } from "@/hooks/use-debounced-value";
export { useStoredState } from "@/hooks/use-stored-state";

export {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
export { default as useActiveWorkspace } from "@/hooks/queries/workspace/use-active-workspace";
export { useWorkspacePermission } from "@/hooks/use-workspace-permission";

// RFC 0004: the teammate app shell and its inbox primitives. Do not export the
// app layout here: the app sidebar imports the Quills entry, so that forms a cycle.
export { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export { UserAvatar } from "@/components/user-avatar";
export { default as WorkspaceArchived } from "@/components/common/workspace-archived";
export { default as useWorkspaceArchived } from "@/hooks/queries/workspace/use-workspace-archived";
export { shortcutRegistry } from "@/lib/shortcuts/registry";
export { parseBinding } from "@/lib/shortcuts/key-combo";
export { ShortcutListener } from "@/lib/shortcuts/shortcut-listener";

// RFC 0005: Kaneo's own project, column and task search reads for the request-to-task dialogs. Kaneo's
// API applies its project access to each of them.
export { default as useGetProjects } from "@/hooks/queries/project/use-get-projects";
export { useGetColumns } from "@/hooks/queries/column/use-get-columns";
export { default as useGlobalSearch } from "@/hooks/queries/search/use-global-search";

// The roadmap drag uses the drop easing of the Kaneo board.
export { EASE_OUT_CSS } from "@/lib/motion";

// RFC 0004 revision 2: the sidebar shell and the shared thread parts.
export {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
export {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/components/ui/combobox";
export {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
export { Badge } from "@/components/ui/badge";
export {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
export { getInitials } from "@/lib/get-initials";
// Kaneo's avatar preparation: a 256 px square crop, re-encoded in the browser before upload.
export { prepareAvatarImage } from "@/lib/prepare-avatar-image";
export { default as useGetWorkspaces } from "@/hooks/queries/workspace/use-get-workspaces";

// Teammate settings (lane S): the Kaneo settings frame, the coss parts of the
// settings pages and the Kaneo instance config (the Billing item and Login).
export { SettingsPage } from "@/components/settings/settings-page";
export { SettingsSection } from "@/components/settings/settings-section";
export { SettingsCard } from "@/components/settings/settings-card";
export { SettingsRow } from "@/components/settings/settings-row";
export { SettingsNote } from "@/components/settings/settings-note";
export { SettingsEmpty } from "@/components/settings/settings-empty";
export {
  RowActionsMenu,
  type RowAction,
} from "@/components/settings/row-actions-menu";
export { ConfirmDialog } from "@/components/settings/confirm-dialog";
export {
  StatusBadge,
  type StatusTone,
} from "@/components/settings/status-badge";
export { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
export {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
export {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
} from "@/components/ui/dialog";
export { default as useGetConfig } from "@/hooks/queries/config/use-get-config";
export { copyToClipboard } from "@/lib/copy-to-clipboard";

// Teammate settings, Connections (lane S): Kaneo's own API keys of the signed-in user.
export { ApiKeysSettings } from "@/components/settings/api-keys/api-keys-settings";

// Teammate settings (lane W): Kaneo's own account, team and billing parts. Account
// composes the parts of Kaneo's ProfilePage, so its sections follow the settings design.
export { AutosaveNote } from "@/components/settings/autosave-note";
export { DeleteAccountSection } from "@/components/settings/profile/delete-account-section";
export { ProfileDetailsSection } from "@/components/settings/profile/profile-details-section";
export { useProfileNameAutosave } from "@/components/settings/profile/use-profile-name-autosave";
export { default as useManagedProfileFields } from "@/hooks/queries/user/use-managed-profile-fields";
export { default as useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
export { default as useListAccounts } from "@/hooks/queries/use-list-accounts";
export { useUserPreferencesStore } from "@/store/user-preferences";
export { default as MembersTable } from "@/components/team/members-table";
export { default as InviteTeamMemberModal } from "@/components/team/invite-team-member-modal";
export { default as useGetFullWorkspace } from "@/hooks/queries/workspace/use-get-full-workspace";
export { BillingSettingsPage } from "@/components/billing/billing-settings-page";
// Group A workspace pages (lane M): the member tabs and the changelog editor.
export { TabsPanel } from "@/components/ui/tabs";
export { Skeleton } from "@/components/ui/skeleton";
// Portal realtime support updates over the user-scoped WebSocket.
export { getUserWsUrl } from "@/hooks/use-user-websocket";
