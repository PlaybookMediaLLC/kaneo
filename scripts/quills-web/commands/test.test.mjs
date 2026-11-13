import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test.mjs";
test("test command is registered", () => assert.equal(typeof run, "function"));
