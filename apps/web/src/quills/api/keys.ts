import type { Viewer } from "../core/types";

export function quillsKey(
  workspaceId: string,
  viewer: Viewer,
  area: string,
  operation: string,
  input?: unknown,
) {
  return [
    "quills",
    workspaceId,
    viewer.kind === "user" ? viewer.id : "anonymous",
    area,
    operation,
    input ?? null,
  ] as const;
}

export function quillsOperationKey(
  workspaceId: string,
  viewer: Viewer,
  area: string,
  operation: string,
) {
  return [
    "quills",
    workspaceId,
    viewer.kind === "user" ? viewer.id : "anonymous",
    area,
    operation,
  ] as const;
}
