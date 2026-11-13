import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultForSchema, zodForSchema } from "./openapi.mjs";

test("nullable OpenAPI fields retain their types in fixtures and forms", () => {
  const schema = {
    type: "object",
    required: ["nextOffset", "conversation"],
    properties: {
      nextOffset: { type: ["number", "null"] },
      conversation: {
        type: "object",
        required: ["csatRating"],
        properties: { csatRating: { type: ["number", "null"] } },
      },
    },
  };
  assert.deepEqual(defaultForSchema({}, schema), {
    nextOffset: null,
    conversation: { csatRating: null },
  });
  assert.equal(
    zodForSchema({}, { type: ["number", "null"], minimum: 1 }),
    "z.union([z.number().min(1), z.null()])",
  );
  assert.equal(
    defaultForSchema({}, { type: ["number", "null"], default: 2 }),
    2,
  );
  assert.equal(defaultForSchema({}, { type: ["boolean", "string"] }), false);
});

test("composed response fixtures retain inherited and added required fields", () => {
  const document = {
    components: {
      schemas: {
        Summary: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string" } },
        },
      },
    },
  };
  const schema = {
    allOf: [
      { $ref: "#/components/schemas/Summary" },
      {
        type: "object",
        required: ["content"],
        properties: { content: { type: "string" } },
      },
    ],
  };
  assert.deepEqual(defaultForSchema(document, schema), {
    title: "value",
    content: "value",
  });
  assert.match(zodForSchema(document, schema), /^z.intersection\(/);
  assert.equal(
    defaultForSchema({}, { anyOf: [{ type: "null" }, { type: "string" }] }),
    null,
  );
  assert.equal(
    zodForSchema({}, { type: "integer", enum: [1, 2] }),
    "z.union([z.literal(1), z.literal(2)])",
  );
});
