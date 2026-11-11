import assert from "node:assert/strict";
import test from "node:test";
import type { FieldSchema, PageSpec } from "../src/types/domain";
import {
  isFieldVisible,
  sanitizeFieldValues,
  serializeFieldValues,
  validateField,
  visibleFieldSchemas,
} from "../src/features/pages/formValidation";
import { parsePageSpec } from "../src/features/pages/parsePageSpec";
import { forTemplate } from "../src/features/pages/contracts/pageProjections";

const fields: FieldSchema[] = [
  { name: "status", type: "enum", required: true, enumValues: ["open", "closed"] },
  {
    name: "reason",
    type: "string",
    required: true,
    visibleWhen: { field: "status", equals: "closed" },
    constraints: { minLength: 3, maxLength: 8, pattern: "[A-Za-z]+" },
  },
  {
    name: "amount",
    type: "number",
    required: false,
    constraints: { min: 1, max: 100 },
  },
  {
    name: "createdBy",
    type: "string",
    required: false,
    constraints: { readonly: true },
  },
  {
    name: "note",
    type: "string",
    required: false,
    constraints: { nullable: true },
  },
];

test("bounded constraints validate strings and numbers", () => {
  assert.match(validateField(fields[1], "ab", false), /at least/);
  assert.match(validateField(fields[1], "ab", true), /至少需要/);
  assert.match(validateField(fields[1], "abcdefghi", true), /最多/);
  assert.match(validateField(fields[1], "123", true), /格式/);
  assert.equal(validateField(fields[1], "Valid", true), "");
  assert.match(validateField(fields[2], "0", true), /不能小于/);
  assert.match(validateField(fields[2], "101", true), /不能大于/);
  assert.equal(validateField(fields[2], "20.5", true), "");
  assert.match(validateField(fields[0], "unknown", true), /有效/);
});

test("an unsafe or oversized pattern never breaks submission", () => {
  const field: FieldSchema = {
    name: "code",
    type: "string",
    required: false,
    constraints: { pattern: "(" },
  };
  assert.match(validateField(field, "abc", true), /格式/);
  field.constraints = { pattern: "x".repeat(201) };
  assert.match(validateField(field, "x", true), /格式/);
});

test("hidden and readonly fields are never serialized, unknown values are dropped", () => {
  assert.equal(isFieldVisible(fields[1], { status: "open" }), false);
  assert.equal(isFieldVisible(fields[1], { status: "closed" }), true);
  assert.deepEqual(
    visibleFieldSchemas(fields, { status: "open" }).map((f) => f.name),
    ["status", "amount", "createdBy", "note"],
  );
  const values = {
    status: "closed",
    reason: "Valid",
    amount: "20.5",
    createdBy: "server",
    note: "keep",
    injected: "secret-marker",
  };
  const result = serializeFieldValues(fields, values, true);
  assert.ok(result.payload);
  assert.deepEqual(JSON.parse(result.payload), {
    status: "closed",
    reason: "Valid",
    amount: 20.5,
    note: "keep",
  });
  assert.equal(result.payload.includes("secret-marker"), false);
  assert.equal(result.payload.includes("createdBy"), false);
  assert.deepEqual(sanitizeFieldValues(fields, values).injected, undefined);
});

test("a hidden field is not required and its value is not sent", () => {
  const result = serializeFieldValues(fields, { status: "open", reason: "stale" }, true);
  assert.ok(result.payload);
  assert.deepEqual(JSON.parse(result.payload), { status: "open" });
});

test("parser accepts bounded constraints and rejects unknown or malformed ones", () => {
  const page: PageSpec = {
    version: 1,
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id"],
    rows: [],
    operations: [
      {
        operation_id: "updateOrder",
        method: "PATCH",
        path: "/orders/{id}",
        role: "update",
        bodySchema: [
          { name: "amount", type: "number", required: true, constraints: { min: 1, max: 10 } },
        ],
      },
    ],
  };
  assert.equal(parsePageSpec(page)?.title, "Orders");
  assert.equal(
    parsePageSpec({
      ...page,
      operations: [
        {
          ...page.operations![0],
          bodySchema: [
            { name: "a", type: "string", required: false, constraints: { unknown: true } },
          ],
        },
      ],
    }),
    null,
  );
  assert.equal(
    parsePageSpec({
      ...page,
      operations: [
        {
          ...page.operations![0],
          bodySchema: [{ name: "a", type: "string", required: false, constraints: { min: "1" } }],
        },
      ],
    }),
    null,
  );
});

test("structural template projection keeps the new constraints", () => {
  const projected = forTemplate({
    version: 1,
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id"],
    rows: [],
    operations: [
      {
        operation_id: "updateOrder",
        method: "PATCH",
        path: "/orders/{id}",
        role: "update",
        bodySchema: fields,
      },
    ],
  });
  const bodySchema = (projected.operations![0].bodySchema ?? []) as Array<{
    constraints?: Record<string, unknown>;
  }>;
  assert.equal(bodySchema[1]?.constraints?.minLength, 3);
  assert.equal(bodySchema[3]?.constraints?.readonly, true);
});
