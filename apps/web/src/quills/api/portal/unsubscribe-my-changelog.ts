import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["changelog"]["subscription"].$delete;
export type UnsubscribeMyChangelogRequest = InferRequestType<typeof endpoint>;
export type UnsubscribeMyChangelogResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const unsubscribeMyChangelogKey = (
  input: UnsubscribeMyChangelogRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "unsubscribeMyChangelog",
    input,
  );
export async function unsubscribeMyChangelog(
  input: UnsubscribeMyChangelogRequest,
): Promise<UnsubscribeMyChangelogResponse> {
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
