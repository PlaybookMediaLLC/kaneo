import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import { {{NAME}}InfiniteQuery, type {{PASCAL}}Request } from "../../api/{{AREA_RAW}}/{{FILE}}";
export function use{{PASCAL}}(input: {{PASCAL}}Request, viewer: Viewer) {
  return useInfiniteQuery({
    ...{{NAME}}InfiniteQuery(input, viewer),
    enabled: Boolean({{REQUIRED}}),
  });
}
