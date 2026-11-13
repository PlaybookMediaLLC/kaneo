import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { {{NAME}} } from {{LOCAL}};
describe({{NAME_JSON}}, () => { describeOperationContract({ operationId: {{OPERATION_ID}}, operation: {{NAME}}, request: {{REQUEST}}, response: {{RESPONSE}}, method: {{METHOD}}, path: {{PATH}}, statuses: {{STATUSES}} }); });
