import assert from "node:assert/strict";
import test from "node:test";
import type { ResponseBinding } from "../src/types/domain";
import {
  parsePointer,
  readPointer,
} from "../src/features/pages/data/jsonPointer";
import {
  MAX_MAPPED_FIELDS,
  MAX_MAPPED_ROWS,
  mapResponse,
} from "../src/features/pages/data/responseMapping";

function binding(overrides: Partial<ResponseBinding> = {}): ResponseBinding {
  return {
    operationKey: "getOrders",
    itemsPointer: "/items",
    rowKeyPointer: "/id",
    fieldPointers: ["/id", "/name"],
    confirmed: true,
    ...overrides,
  };
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
}

// ---------------------------------------------------------------------------
// RFC 6901 pointer parsing / reading
// ---------------------------------------------------------------------------

test("parsePointer implements RFC6901 root, segments, and ~1/~0 decode order", () => {
  assert.deepEqual(parsePointer(""), { segments: [] });
  assert.deepEqual(parsePointer("/a/b"), { segments: ["a", "b"] });
  assert.deepEqual(parsePointer("/"), { segments: [""] });
  assert.deepEqual(parsePointer("/m~1n"), { segments: ["m/n"] });
  assert.deepEqual(parsePointer("/m~0n"), { segments: ["m~n"] });
  assert.deepEqual(parsePointer("/~01"), { segments: ["~1"] });
  assert.deepEqual(parsePointer("/a~0~1b"), { segments: ["a~/b"] });
});

test("parsePointer rejects syntax errors and unsafe prototype segments case-insensitively", () => {
  assert.equal(parsePointer("items").error, "pointer.syntax");
  assert.equal(parsePointer("a/b").error, "pointer.syntax");
  assert.equal(parsePointer("/a~2b").error, "pointer.syntax");
  assert.equal(parsePointer("/a~").error, "pointer.syntax");
  assert.equal(parsePointer("/~").error, "pointer.syntax");
  assert.equal(parsePointer("/__proto__").error, "pointer.unsafe");
  assert.equal(parsePointer("/PROTOTYPE").error, "pointer.unsafe");
  assert.equal(parsePointer("/a/Constructor/x").error, "pointer.unsafe");
  assert.equal(parsePointer("/a").error, undefined);
});

test("readPointer returns the root value and traverses plain objects/arrays", () => {
  const body = { items: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(readPointer(body, ""), { found: true, value: body });
  assert.deepEqual(readPointer(body, "/items/1/id"), { found: true, value: 2 });
  assert.deepEqual(readPointer(body, "/items/0"), { found: true, value: { id: 1 } });
  assert.deepEqual(readPointer({ "a/b": 1 }, "/a~1b"), { found: true, value: 1 });
});

test("readPointer enforces non-negative array indices without leading zeros", () => {
  assert.deepEqual(readPointer([10, 20], "/0"), { found: true, value: 10 });
  assert.equal(readPointer([10, 20], "/01").issue, "pointer.syntax");
  assert.equal(readPointer([10], "/-1").issue, "pointer.syntax");
  assert.equal(readPointer([10], "/-").issue, "pointer.syntax");
  assert.equal(readPointer([10], "/1.5").issue, "pointer.syntax");
  assert.equal(readPointer([10], "/1").issue, "pointer.missing");
  assert.equal(readPointer([10], "/999999999999999999999").issue, "pointer.missing");
});

test("readPointer reports stable issues for missing/unsafe/traversal and never throws", () => {
  assert.equal(readPointer({ a: 1 }, "/missing").issue, "pointer.missing");
  assert.equal(readPointer({ a: 1 }, "/a/b").issue, "pointer.traversal");
  assert.equal(readPointer(null, "/a").issue, "pointer.traversal");
  assert.equal(readPointer({ a: 1 }, "/__proto__").issue, "pointer.unsafe");
  assert.equal(readPointer({ a: 1 }, "a").issue, "pointer.syntax");
  const issue = readPointer({ secret: "TOP-SECRET-42" }, "/nope").issue;
  assert.ok(!String(issue).includes("TOP-SECRET-42"));
  assert.doesNotThrow(() => readPointer({ a: 42 }, "/a/b/c/d"));
});

test("readPointer never evaluates expressions or expands wildcards", () => {
  const body = { "*": 2, "a*": 1, items: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(readPointer(body, "/*"), { found: true, value: 2 });
  // "[*]" is a literal object key here; it is never expanded into a wildcard match.
  assert.equal(readPointer(body, "/items[*]/id").issue, "pointer.missing");
  // As an array segment, "[*]" is not a valid non-negative integer index.
  assert.equal(readPointer(body, "/items/[*]/id").issue, "pointer.syntax");
  assert.equal(readPointer(body, "/items/0/../id").issue, "pointer.missing");
});

// ---------------------------------------------------------------------------
// mapResponse
// ---------------------------------------------------------------------------

test("mapResponse keeps raw record values and produces typed keys", () => {
  const body = {
    items: [{ id: 1, name: "Alpha", active: false, price: 0, meta: { score: 3.5 } }],
  };
  const result = mapResponse(body, binding());
  assert.equal(result.status, "mapped");
  assert.equal(result.writable, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.records, body.items);
  assert.equal(typeof result.records[0].active, "boolean");
  assert.equal(typeof result.records[0].price, "number");
  assert.deepEqual(result.records[0].meta, { score: 3.5 });
  assert.deepEqual(result.keys[0], {
    type: "number",
    value: 1,
    identity: "number:1",
    pathValue: "1",
  });
  assert.equal(result.total, undefined);
  assert.deepEqual(result.truncated, { rows: false, fields: false });
});

test("mapResponse is independent of object key order", () => {
  const first = mapResponse({ items: [{ id: 1, name: "A" }] }, binding());
  const second = mapResponse({ items: [{ name: "A", id: 1 }] }, binding());
  assert.deepEqual(first, second);
});

test("mapResponse tolerates missing display fields without guessing", () => {
  const result = mapResponse(
    { items: [{ id: 1 }] },
    binding({ fieldPointers: ["/id", "/missing"] }),
  );
  assert.equal(result.status, "mapped");
  assert.deepEqual(result.records, [{ id: 1 }]);
  assert.equal(result.truncated.fields, false);
});

test("mapResponse accepts 0 and false as keys but rejects null", () => {
  const zero = mapResponse({ items: [{ id: 0 }] }, binding());
  assert.equal(zero.keys[0]?.identity, "number:0");
  assert.equal(zero.writable, true);
  const falsy = mapResponse({ items: [{ id: false }] }, binding());
  assert.equal(falsy.keys[0]?.identity, "boolean:false");
  const nullKey = mapResponse({ items: [{ id: null }] }, binding());
  assert.equal(nullKey.keys[0], null);
  assert.equal(nullKey.writable, false);
  assert.ok(nullKey.issues.some((issue) => issue.code === "record.key_missing"));
});

test("mapResponse distinguishes string 001 from number 1 identities", () => {
  const result = mapResponse({ items: [{ id: "001" }, { id: 1 }] }, binding());
  assert.equal(result.writable, true);
  assert.deepEqual(
    result.keys.map((key) => key?.identity),
    ["string:001", "number:1"],
  );
});

test("mapResponse reports duplicate identities and disables writes", () => {
  const result = mapResponse({ items: [{ id: 1 }, { id: 1 }] }, binding());
  assert.equal(result.writable, false);
  assert.equal(result.keys.length, 2);
  assert.ok(result.issues.some((issue) => issue.code === "record.key_duplicate"));
});

test("mapResponse resolves nested rowKeyPointer and encodes path value", () => {
  const result = mapResponse(
    { items: [{ meta: { id: "a/b" }, name: "A" }] },
    binding({ rowKeyPointer: "/meta/id" }),
  );
  assert.equal(result.writable, true);
  assert.deepEqual(result.keys[0], {
    type: "string",
    value: "a/b",
    identity: "string:a/b",
    pathValue: "a%2Fb",
  });
});

test("mapResponse decodes ~1 and ~0 in items and field pointers", () => {
  const result = mapResponse(
    { "data/list": [{ "user~name": "Ada", id: 1 }] },
    binding({
      itemsPointer: "/data~1list",
      rowKeyPointer: "/id",
      fieldPointers: ["/user~0name"],
    }),
  );
  assert.equal(result.status, "mapped");
  assert.deepEqual(result.records, [{ "user~name": "Ada", id: 1 }]);
  assert.equal(result.truncated.fields, false);
});

test("mapResponse rejects unsafe prototype pointer segments as invalid", () => {
  const result = mapResponse(
    { items: [{ id: 1 }] },
    binding({ itemsPointer: "/__proto__/items" }),
  );
  assert.equal(result.status, "invalid");
  assert.equal(result.writable, false);
  assert.deepEqual(result.records, []);
  assert.ok(result.issues.some((issue) => issue.code === "response.items_not_array"));
});

test("mapResponse rejects malformed itemsPointer as invalid", () => {
  const result = mapResponse({ items: [{ id: 1 }] }, binding({ itemsPointer: "items" }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.code === "response.items_not_array"));
});

test("mapResponse treats an empty items array as empty and preserves total 0", () => {
  const result = mapResponse(
    { items: [], total: 0 },
    binding({ totalPointer: "/total" }),
  );
  assert.equal(result.status, "empty");
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.keys, []);
  assert.equal(result.total, 0);
  assert.equal(result.writable, false);
  assert.deepEqual(result.issues, []);
});

test("mapResponse never unwraps known list keys when itemsPointer misses", () => {
  const missing = mapResponse({ data: [{ id: 1 }] }, binding({ itemsPointer: "/items" }));
  assert.equal(missing.status, "invalid");
  assert.deepEqual(missing.records, []);
  assert.ok(missing.issues.some((issue) => issue.code === "response.items_not_array"));

  const notArray = mapResponse({ items: { id: 1 } }, binding());
  assert.equal(notArray.status, "invalid");
  assert.deepEqual(notArray.records, []);
});

test("mapResponse never fabricates total from row count", () => {
  const items = Array.from({ length: MAX_MAPPED_ROWS }, (_, index) => ({ id: index }));
  const result = mapResponse({ items }, binding());
  assert.equal(result.total, undefined);
});

test("mapResponse keeps total 0 and rejects negative, string, boolean, null, float, missing", () => {
  const at = (total: unknown) =>
    mapResponse({ items: [{ id: 1 }], total }, binding({ totalPointer: "/total" }));

  assert.equal(at(0).total, 0);
  assert.equal(at(42).total, 42);

  const negative = at(-3);
  assert.equal(negative.total, undefined);
  assert.ok(negative.issues.some((issue) => issue.code === "response.total_negative"));

  for (const bad of ["5", true, null, 1.5, NaN, Infinity, {}, []]) {
    const invalid = at(bad);
    assert.equal(invalid.total, undefined, `expected no total for ${typeof bad}`);
    assert.ok(invalid.issues.some((issue) => issue.code === "response.total_invalid"));
  }

  const missing = mapResponse({ items: [{ id: 1 }] }, binding({ totalPointer: "/total" }));
  assert.equal(missing.total, undefined);
  assert.ok(missing.issues.some((issue) => issue.code === "response.total_invalid"));
});

test("mapResponse resolves totalPointer relative to the whole body", () => {
  const result = mapResponse(
    { items: [{ id: 1 }], page: { total: 42 } },
    binding({ totalPointer: "/page/total" }),
  );
  assert.equal(result.total, 42);
});

test("mapResponse supports a root array via an empty itemsPointer", () => {
  const result = mapResponse([{ id: 1 }, { id: 2 }], binding({ itemsPointer: "" }));
  assert.equal(result.status, "mapped");
  assert.equal(result.records.length, 2);
  assert.equal(result.keys.length, 2);
  assert.equal(result.writable, true);
  assert.equal(result.total, undefined);
});

test("mapResponse previews confirmed=false bindings without enabling writes", () => {
  const result = mapResponse({ items: [{ id: 1 }] }, binding({ confirmed: false }));
  assert.equal(result.status, "unconfirmed");
  assert.equal(result.records.length, 1);
  assert.equal(result.keys.length, 1);
  assert.equal(result.writable, false);
  assert.deepEqual(result.issues, []);
});

test("mapResponse truncates rows strictly above MAX_MAPPED_ROWS", () => {
  for (const count of [100, 101]) {
    const items = Array.from({ length: count }, (_, index) => ({ id: index }));
    const result = mapResponse({ items }, binding());
    assert.equal(result.records.length, Math.min(count, MAX_MAPPED_ROWS));
    assert.equal(result.keys.length, result.records.length);
    assert.equal(result.truncated.rows, count > MAX_MAPPED_ROWS);
  }
});

test("mapResponse truncates fields strictly above MAX_MAPPED_FIELDS", () => {
  for (const count of [50, 51]) {
    const fieldPointers = Array.from({ length: count }, (_, index) => `/f${index}`);
    const result = mapResponse({ items: [{ id: 1 }] }, binding({ fieldPointers }));
    assert.equal(result.truncated.fields, count > MAX_MAPPED_FIELDS);
    assert.equal(result.records.length, 1);
  }
});

test("mapResponse honors maxRows/maxFields options", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: index }));
  const result = mapResponse(
    { items },
    binding({ fieldPointers: ["/a", "/b", "/c"] }),
    { maxRows: 2, maxFields: 1 },
  );
  assert.equal(result.records.length, 2);
  assert.equal(result.truncated.rows, true);
  assert.equal(result.truncated.fields, true);
});

test("mapResponse skips non-object items and keeps records/keys aligned", () => {
  const result = mapResponse(
    { items: [{ id: 1 }, null, [1, 2], 5, { id: 2 }] },
    binding(),
  );
  assert.equal(result.records.length, 2);
  assert.equal(result.keys.length, 2);
  assert.ok(result.issues.some((issue) => issue.code === "response.record_skipped"));
  assert.ok(
    result.issues
      .filter((issue) => issue.code === "response.record_skipped")
      .every((issue) => issue.message.includes("count=3")),
  );
});

test("mapResponse does not stringify nested object/array values", () => {
  const body = {
    items: [{ id: 1, nested: { list: [1, 2] }, flag: true, amount: 0 }],
  };
  const result = mapResponse(body, binding());
  assert.deepEqual(result.records[0], body.items[0]);
  assert.equal(typeof result.records[0].flag, "boolean");
  assert.equal(typeof result.records[0].amount, "number");
  assert.deepEqual(result.records[0].nested, { list: [1, 2] });
});

test("mapResponse is deterministic for identical inputs", () => {
  const body = { items: [{ id: 1, name: "A" }, { id: 2, name: "B" }], total: 9 };
  const config = binding({ totalPointer: "/total" });
  assert.deepEqual(mapResponse(body, config), mapResponse(body, config));
});

test("mapResponse does not mutate body or binding (deep-frozen inputs)", () => {
  const body = { items: [{ id: 1, meta: { x: 1 } }], total: 9 };
  const config = binding({ totalPointer: "/total" });
  const expectedBody = { items: [{ id: 1, meta: { x: 1 } }], total: 9 };
  const expectedConfig = { ...config, fieldPointers: [...config.fieldPointers] };
  deepFreeze(body);
  deepFreeze(config);
  const result = mapResponse(body, config);
  assert.deepEqual(body, expectedBody);
  assert.deepEqual(config, expectedConfig);
  assert.equal(result.status, "mapped");
  assert.equal(result.total, 9);
});

test("mapResponse issues never embed response values, field values, or tokens", () => {
  const body = {
    items: [{ id: "SECRET-ID", token: "Bearer abc123" }],
    total: "not-a-number",
  };
  const result = mapResponse(body, binding({ totalPointer: "/total" }));
  for (const issue of result.issues) {
    const text = `${issue.code} ${issue.message} ${issue.pointer ?? ""}`;
    assert.ok(!text.includes("SECRET-ID"));
    assert.ok(!text.includes("Bearer"));
    assert.ok(!text.includes("abc123"));
    assert.ok(!text.includes("not-a-number"));
  }
  assert.ok(!JSON.stringify(result.issues).includes("abc123"));
});

test("an empty totalPointer means unresolved, not the whole response as a total", () => {
  const body = { items: [{ id: 1 }, { id: 2 }], total: 2 };
  const result = mapResponse(body, binding({ totalPointer: "" }));
  assert.equal(result.status, "mapped");
  assert.equal(result.total, undefined);
  assert.equal(
    result.issues.some((issue) => issue.code === "response.total_invalid"),
    false,
  );
  assert.equal(result.writable, true);
});
