import { lazy } from "react";
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

export { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
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

// Loaded on demand: the app sidebar imports the Quills entry, so a static
// import would form a cycle and pull the app shell into portal pages.
export const WorkspaceLayout = lazy(
  () => import("@/components/common/workspace-layout"),
);
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
