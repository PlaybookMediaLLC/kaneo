import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem{{VIEWER_TYPE}} } from "../../core/types";
{{KEY_IMPORT}}import { {{NAME}}, type {{PASCAL}}Request, type {{PASCAL}}Response } from "../../api/{{AREA_RAW}}/{{FILE}}";
export function use{{PASCAL}}({{VIEWER_ARGUMENT}}) {
  const queryClient = useQueryClient();
  return useMutation<{{PASCAL}}Response, PortalProblem, {{PASCAL}}Request{{CONTEXT_TYPE}}>({ mutationFn: (input) => {{NAME}}(input), {{OPTIMISTIC}}onSuccess: async (_data, input) => { {{INVALIDATIONS}} } });
}
