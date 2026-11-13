import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["uploads"]["prepare"].$post;
export type PreparePortalUploadRequest = InferRequestType<typeof endpoint>;
export type PreparePortalUploadResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const preparePortalUploadKey = (
  input: PreparePortalUploadRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "files",
    "preparePortalUpload",
    input,
  );
export async function preparePortalUpload(
  input: PreparePortalUploadRequest,
): Promise<PreparePortalUploadResponse> {
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
