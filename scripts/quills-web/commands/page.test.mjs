import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./page.mjs";
test("page command is registered", () => assert.equal(typeof run, "function"));
