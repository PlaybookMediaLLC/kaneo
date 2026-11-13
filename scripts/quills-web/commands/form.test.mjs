import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./form.mjs";
test("form command is registered", () => assert.equal(typeof run, "function"));
