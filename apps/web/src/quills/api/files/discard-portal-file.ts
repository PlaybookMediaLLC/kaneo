import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["files"][":fileId"].$delete;
export type DiscardPortalFileRequest = InferRequestType<typeof endpoint>;
export type DiscardPortalFileResponse = InferResponseType<typeof endpoint, 200>;
export const discardPortalFileKey = (
  input: DiscardPortalFileRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspace, viewer, "files", "discardPortalFile", input);
export async function discardPortalFile(
  input: DiscardPortalFileRequest,
): Promise<DiscardPortalFileResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
