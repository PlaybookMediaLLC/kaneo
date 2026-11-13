import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./part.mjs";
test("part command is registered", () => assert.equal(typeof run, "function"));
