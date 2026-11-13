import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./redirect.mjs";
test("redirect command is registered", () =>
  assert.equal(typeof run, "function"));
