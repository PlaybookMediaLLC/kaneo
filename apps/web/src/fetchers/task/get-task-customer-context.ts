import { quillsClient } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

const endpoint =
  quillsClient["quills"][":workspaceId"]["tasks"][":taskId"]["customer-context"]
    .$get;

export type TaskCustomerContextResponse = InferResponseType<
  typeof endpoint,
  200
>;

export async function getTaskCustomerContext(
  workspaceId: string,
  taskId: string,
): Promise<TaskCustomerContextResponse | null> {
  const response = await endpoint({
    param: { workspaceId, taskId },
  });
  if (response.status === 403 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load customer context (${response.status})`);
  }
  return response.json();
}
