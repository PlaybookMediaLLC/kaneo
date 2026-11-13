export type Audience = "public" | "portal" | "signed-in" | "teammate";

export type Viewer = { kind: "anonymous" } | { kind: "user"; id: string };

export interface PortalBranding {
  logoUrl: string | null;
  theme: {
    themeMode: "light" | "dark" | "user";
    light: Record<string, string>;
    dark: Record<string, string>;
  };
  headerDisplayMode: "logo_and_name" | "logo_only" | "custom_logo";
  headerDisplayName: string | null;
}

export type PortalProblemKind =
  | "authRequired"
  | "noAccess"
  | "notFound"
  | "gone"
  | "conflict"
  | "invalid"
  | "rateLimited"
  | "failed";

export interface PortalProblem {
  kind: PortalProblemKind;
  retryAt?: number;
  issues?: Array<{ path: string; message: string }>;
}

export interface PageMeta {
  id: string;
  feature: string;
  route: string;
  audience: Audience | "development";
  mailLinked: boolean;
  token: "none" | "query" | "fragment";
  operations: string[];
  states: string[];
}
