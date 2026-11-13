import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./component.mjs";
test("component command is registered", () =>
  assert.equal(typeof run, "function"));
