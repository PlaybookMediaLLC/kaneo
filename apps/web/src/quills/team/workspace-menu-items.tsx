import { Link } from "@tanstack/react-router";
import { MenuItem, useGetWorkspaces } from "../ui/upstream";
import { teamHref } from "./team-href";

/** The caller's workspaces in the switcher menu. It loads them when the menu opens. */
export function WorkspaceMenuItems() {
  const { data: workspaces } = useGetWorkspaces();
  return workspaces?.map((workspace) => (
    <MenuItem key={workspace.id} render={<Link to={teamHref(workspace.id)} />}>
      {workspace.name}
    </MenuItem>
  ));
}
