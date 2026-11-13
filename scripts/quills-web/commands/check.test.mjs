import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./check.mjs";
test("check command is registered", () => assert.equal(typeof run, "function"));
