import type { Viewer } from "./types";
import { authClient } from "../ui/upstream";

export function usePortalViewer(): Viewer {
  const { data } = authClient.useSession();
  return data?.user.id
    ? { kind: "user", id: data.user.id }
    : { kind: "anonymous" };
}
