import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
{{KEY_IMPORT}}import { {{NAME}}Fixture } from "../../api/{{AREA_RAW}}/{{FILE}}.fixture";
import { use{{PASCAL}} } from "./use-{{FILE}}";
describe({{HOOK_NAME}}, () => { describeHookContract({
  kind: {{KIND}}, hook: use{{PASCAL}}, operationId: {{OPERATION_ID}},
  request: {{REQUEST}}, {{EMPTY_REQUEST}}
  response: {{NAME}}Fixture.ok(), viewer: { kind: "anonymous" }, takesViewer: {{TAKES_VIEWER}},
  invalidates: [{{INVALIDATIONS}}],
  {{PAGED}}
  {{POLL_MS}}
  {{OPTIMISTIC_TEST}}
}); });
