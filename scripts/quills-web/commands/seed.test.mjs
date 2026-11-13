import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./seed.mjs";
test("seed command is registered", () => assert.equal(typeof run, "function"));
