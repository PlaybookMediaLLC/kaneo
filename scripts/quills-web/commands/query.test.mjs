import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./query.mjs";
test("query command is registered", () => assert.equal(typeof run, "function"));
