import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRecordKeys,
  recordKeyAt,
} from "../src/features/pages/data/recordKey";

test("recordKeyAt accepts non-blank strings and keeps typed identity plus encoded path value", () => {
  assert.deepEqual(recordKeyAt({ id: "001" }, "/id"), {
    key: { type: "string", value: "001", identity: "string:001", pathValue: "001" },
  });
  const spaced = recordKeyAt({ id: " a/b " }, "/id");
  assert.equal(spaced.issue, undefined);
  assert.equal(spaced.key?.value, " a/b ");
  assert.equal(spaced.key?.identity, "string: a/b ");
  assert.equal(spaced.key?.pathValue, "%20a%2Fb%20");
});

test("recordKeyAt accepts finite numbers (including 0) and both booleans", () => {
  assert.deepEqual(recordKeyAt({ id: 0 }, "/id").key, {
    type: "number",
    value: 0,
    identity: "number:0",
    pathValue: "0",
  });
  assert.equal(recordKeyAt({ id: 1.5 }, "/id").key?.identity, "number:1.5");
  assert.equal(recordKeyAt({ id: -2 }, "/id").key?.identity, "number:-2");
  assert.deepEqual(recordKeyAt({ id: false }, "/id").key, {
    type: "boolean",
    value: false,
    identity: "boolean:false",
    pathValue: "false",
  });
  assert.equal(recordKeyAt({ id: true }, "/id").key?.identity, "boolean:true");
});

test("recordKeyAt keeps string \"001\" distinct from number 1", () => {
  const asString = recordKeyAt({ id: "001" }, "/id").key;
  const asNumber = recordKeyAt({ id: 1 }, "/id").key;
  assert.equal(asString?.identity, "string:001");
  assert.equal(asNumber?.identity, "number:1");
  assert.notEqual(asString?.identity, asNumber?.identity);
});

test("recordKeyAt rejects null/undefined/object/array/NaN/Infinity/blank values", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    {},
    [],
    NaN,
    Infinity,
    -Infinity,
    "",
    "   ",
    1n,
    () => 1,
  ];
  for (const value of invalid) {
    const result = recordKeyAt({ id: value }, "/id");
    assert.equal(result.key, undefined, `expected no key for ${typeof value}`);
    assert.equal(result.issue, "record.key_missing");
  }
});

test("recordKeyAt supports nested pointers and ~0/~1 escaped keys", () => {
  assert.deepEqual(recordKeyAt({ meta: { id: 7 } }, "/meta/id").key, {
    type: "number",
    value: 7,
    identity: "number:7",
    pathValue: "7",
  });
  assert.equal(recordKeyAt({ "a/b~c": "x" }, "/a~1b~0c").key?.identity, "string:x");
});

test("recordKeyAt refuses unsafe or malformed pointers without throwing", () => {
  assert.doesNotThrow(() => recordKeyAt({ id: 1 }, "/__proto__"));
  assert.equal(recordKeyAt({ id: 1 }, "/__proto__").key, undefined);
  assert.equal(recordKeyAt({ id: 1 }, "/__proto__").issue, "record.key_missing");
  assert.equal(recordKeyAt({ id: 1 }, "id").issue, "record.key_missing");
  assert.equal(recordKeyAt({ id: 1 }, "/a~2").issue, "record.key_missing");
  assert.equal(recordKeyAt(5, "/id").issue, "record.key_missing");
});

test("collectRecordKeys keeps keys aligned with records and accepts unique keys", () => {
  const result = collectRecordKeys([{ id: 1 }, { id: 2 }], "/id");
  assert.equal(result.keys.length, 2);
  assert.deepEqual(
    result.keys.map((key) => key?.identity),
    ["number:1", "number:2"],
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.writable, true);
});

test("collectRecordKeys flags missing keys with a null slot and disables writes", () => {
  const result = collectRecordKeys([{ id: 1 }, { name: "x" }, { id: 3 }], "/id");
  assert.equal(result.keys.length, 3);
  assert.equal(result.keys[1], null);
  assert.equal(result.writable, false);
  assert.ok(result.issues.includes("record.key_missing"));
});

test("collectRecordKeys flags duplicate identities but keeps distinct raw types", () => {
  const duplicated = collectRecordKeys([{ id: 1 }, { id: 1 }, { id: 2 }], "/id");
  assert.equal(duplicated.writable, false);
  assert.equal(duplicated.keys.length, 3);
  assert.ok(duplicated.issues.includes("record.key_duplicate"));

  const distinct = collectRecordKeys([{ id: "001" }, { id: 1 }], "/id");
  assert.equal(distinct.writable, true);
  assert.deepEqual(distinct.issues, []);
});

test("collectRecordKeys de-duplicates issues and never leaks ID values", () => {
  const result = collectRecordKeys([{ id: 1 }, { id: 1 }, { name: "x" }, { id: 1 }], "/id");
  assert.deepEqual(result.issues, ["record.key_missing", "record.key_duplicate"]);

  const many = Array.from({ length: 300 }, (_, index) =>
    index % 3 === 0 ? { id: `SENSITIVE-${index}` } : { id: "DUP" },
  );
  const bounded = collectRecordKeys(many, "/id");
  assert.equal(bounded.keys.length, 300);
  assert.equal(bounded.writable, false);
  assert.deepEqual(bounded.issues, ["record.key_duplicate"]);
  for (const issue of bounded.issues) {
    assert.ok(!issue.includes("SENSITIVE"));
    assert.ok(!issue.includes("DUP"));
  }
});

test("collectRecordKeys resolves nested pointers for the whole batch", () => {
  const result = collectRecordKeys(
    [{ meta: { id: "a" } }, { meta: { id: "b" } }],
    "/meta/id",
  );
  assert.equal(result.writable, true);
  assert.deepEqual(
    result.keys.map((key) => key?.pathValue),
    ["a", "b"],
  );
});
