import type { PortalProblem } from "../core/types";
import { HttpError } from "../ui/upstream";
import { retryAfterAt } from "../core/retry-after";

// A portal 403 on a record hides the record. A teammate 403 is a denied action.
export async function toPortalProblem(
  response: Response,
  target: "record" | "collection" | "teammate" = "record",
  token = false,
): Promise<PortalProblem> {
  const error = await HttpError.fromResponse(response);
  if (error.status === 401) return { kind: "authRequired" };
  if (error.status === 403) {
    return { kind: target === "record" ? "notFound" : "noAccess" };
  }
  if (error.status === 404) return { kind: token ? "gone" : "notFound" };
  if (error.status === 410) return { kind: "gone" };
  if (error.status === 409) return { kind: "conflict" };
  if (error.status === 429)
    return {
      kind: "rateLimited",
      retryAt: retryAfterAt(response.headers.get("retry-after")),
    };
  if (
    error.status === 422 ||
    (error.status === 400 && error.code === "VALIDATION_ERROR")
  ) {
    return {
      kind: "invalid",
      issues: error.issues?.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  return { kind: "failed" };
}

export function networkPortalProblem(): PortalProblem {
  return { kind: "failed" };
}
