import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["translations"].$post;
export type TranslatePortalContentRequest = InferRequestType<typeof endpoint>;
export type TranslatePortalContentResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const translatePortalContentKey = (
  input: TranslatePortalContentRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "translatePortalContent",
    input,
  );
export async function translatePortalContent(
  input: TranslatePortalContentRequest,
): Promise<TranslatePortalContentResponse> {
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
export const translatePortalContentQuery = (
  input: TranslatePortalContentRequest,
  viewer: Viewer,
) =>
  queryOptions<TranslatePortalContentResponse, PortalProblem>({
    queryKey: translatePortalContentKey(input, viewer),
    queryFn: () => translatePortalContent(input),
  });
