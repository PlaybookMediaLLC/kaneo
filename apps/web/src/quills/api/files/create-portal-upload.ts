import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["uploads"].$post;
export type CreatePortalUploadRequest = InferRequestType<typeof endpoint>;
export type CreatePortalUploadResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const createPortalUploadKey = (
  input: CreatePortalUploadRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "files",
    "createPortalUpload",
    input,
  );
export async function createPortalUpload(
  input: CreatePortalUploadRequest,
): Promise<CreatePortalUploadResponse> {
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
