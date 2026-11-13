import type { InferRequestType, InferResponseType } from "hono/client";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["invites"][":inviteId"][
    "accept"
  ].$post;
export type AcceptPortalInviteRequest = InferRequestType<typeof endpoint>;
export type AcceptPortalInviteResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const acceptPortalInviteKey = (
  input: AcceptPortalInviteRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "acceptPortalInvite",
    input,
  );
export async function acceptPortalInvite(
  input: AcceptPortalInviteRequest,
): Promise<AcceptPortalInviteResponse> {
  try {
    const response = await endpoint(input);
    if (response.status === 409) throw { kind: "gone" } satisfies PortalProblem;
    if (!response.ok) throw await toPortalProblem(response, "record", true);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
