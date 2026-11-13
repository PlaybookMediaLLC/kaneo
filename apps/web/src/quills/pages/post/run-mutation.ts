import type { PortalProblem } from "../../core/types";
export async function runMutation<T>(
  mutation: () => Promise<T>,
): Promise<PortalProblem | void> {
  try {
    await mutation();
  } catch (problem) {
    return problem as PortalProblem;
  }
}
