import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { {{NAME}} } from {{LOCAL}};
describe({{NAME_JSON}}, () => { describeHookContract({ kind: {{KIND}}, hook: {{NAME}}, operationId: {{OPERATION_ID}}, request: {{REQUEST}}, response: {}, viewer: { kind: "anonymous" }, invalidates: [] }); });
