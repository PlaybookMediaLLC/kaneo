import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./mutation.mjs";
test("mutation command is registered", () =>
  assert.equal(typeof run, "function"));
