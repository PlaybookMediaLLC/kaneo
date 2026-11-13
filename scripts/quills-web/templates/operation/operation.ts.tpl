import type { InferRequestType, InferResponseType } from "hono/client";
{{QUERY_IMPORT}}import type { {{PROBLEM_TYPE}}Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = {{ENDPOINT}};
export type {{PASCAL}}Request = InferRequestType<typeof endpoint>;
export type {{PASCAL}}Response = InferResponseType<typeof endpoint, {{STATUS}}>;
export const {{NAME}}Key = (input: {{PASCAL}}Request, viewer: Viewer) =>
  quillsKey(input.param.{{WORKSPACE_PARAM}}, viewer, {{AREA}}, {{NAME_JSON}}, input);
export async function {{NAME}}(input: {{PASCAL}}Request): Promise<{{PASCAL}}Response> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", {{TOKEN_OPERATION}});
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error) throw error;
    throw networkPortalProblem();
  }
}
{{QUERY_OPTIONS}}
