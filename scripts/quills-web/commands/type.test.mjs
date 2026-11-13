import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./type.mjs";
test("type command is registered", () => assert.equal(typeof run, "function"));
