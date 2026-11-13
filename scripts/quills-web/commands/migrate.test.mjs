import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./migrate.mjs";
test("migrate command is registered", () =>
  assert.equal(typeof run, "function"));
