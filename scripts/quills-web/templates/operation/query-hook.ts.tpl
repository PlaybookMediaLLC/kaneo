import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import { {{NAME}}Query, type {{PASCAL}}Request } from "../../api/{{AREA_RAW}}/{{FILE}}";
export function use{{PASCAL}}(input: {{PASCAL}}Request, viewer: Viewer) {
  return useQuery({ ...{{NAME}}Query(input, viewer), enabled: Boolean({{REQUIRED}}){{POLL}} });
}
