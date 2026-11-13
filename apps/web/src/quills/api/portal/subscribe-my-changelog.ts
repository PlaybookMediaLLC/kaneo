import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["changelog"]["subscription"].$put;
export type SubscribeMyChangelogRequest = InferRequestType<typeof endpoint>;
export type SubscribeMyChangelogResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const subscribeMyChangelogKey = (
  input: SubscribeMyChangelogRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "subscribeMyChangelog",
    input,
  );
export async function subscribeMyChangelog(
  input: SubscribeMyChangelogRequest,
): Promise<SubscribeMyChangelogResponse> {
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
