import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./list.mjs";
test("list command is registered", () => assert.equal(typeof run, "function"));
