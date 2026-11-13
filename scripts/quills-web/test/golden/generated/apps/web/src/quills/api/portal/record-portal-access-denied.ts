import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["access-denied"].$post;
export type RecordPortalAccessDeniedRequest = InferRequestType<typeof endpoint>;
export type RecordPortalAccessDeniedResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const recordPortalAccessDeniedKey = (
  input: RecordPortalAccessDeniedRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "recordPortalAccessDenied",
    input,
  );
export async function recordPortalAccessDenied(
  input: RecordPortalAccessDeniedRequest,
): Promise<RecordPortalAccessDeniedResponse> {
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
