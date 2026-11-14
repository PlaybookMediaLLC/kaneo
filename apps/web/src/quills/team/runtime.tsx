import { createContext, type ReactNode, useContext } from "react";
import type { Viewer } from "../core/types";

// The permissions only show or hide controls. The teammate API is the authority.
export interface TeamPermissions {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  manageSettings: boolean;
}

export interface TeamRuntimeValue {
  workspaceId: string;
  viewer: Extract<Viewer, { kind: "user" }>;
  permissions: TeamPermissions;
}

const TeamRuntimeContext = createContext<TeamRuntimeValue | null>(null);

export function TeamRuntimeProvider({
  value,
  children,
}: {
  value: TeamRuntimeValue;
  children: ReactNode;
}) {
  return (
    <TeamRuntimeContext.Provider value={value}>
      {children}
    </TeamRuntimeContext.Provider>
  );
}

export function useTeamRuntime() {
  const value = useContext(TeamRuntimeContext);
  if (!value)
    throw new Error("useTeamRuntime must be used inside TeamRuntimeProvider");
  return value;
}
