import { describe } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { {{NAME}} } from "./{{FILE}}";
import { {{NAME}}Fixture } from "./{{FILE}}.fixture";
describe({{NAME_JSON}}, () => { describeOperationContract({ operationId: {{OPERATION_ID}}, operation: {{NAME}}, request: {{REQUEST}}, response: {{NAME}}Fixture.ok(), method: {{METHOD}}, path: {{PATH}}, statuses: {{STATUSES}} }); });
