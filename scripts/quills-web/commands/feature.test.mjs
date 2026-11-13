import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./feature.mjs";
test("feature command is registered", () =>
  assert.equal(typeof run, "function"));
