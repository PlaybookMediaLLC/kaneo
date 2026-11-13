import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["portal"]["files"].$post;
export type CreatePortalFilesRequest = InferRequestType<typeof endpoint>;
export type CreatePortalFilesResponse = InferResponseType<typeof endpoint, 200>;
export const createPortalFilesKey = (
  input: CreatePortalFilesRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspace, viewer, "files", "createPortalFiles", input);
export async function createPortalFiles(
  input: CreatePortalFilesRequest,
): Promise<CreatePortalFilesResponse> {
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
