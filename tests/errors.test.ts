import assert from "node:assert/strict";
import test from "node:test";
import { toUserMessage } from "../src/lib/errors";

test("passes plain strings through", () => {
  assert.equal(toUserMessage("磁盘已满"), "磁盘已满");
});

test("reads the message from an Error instance", () => {
  assert.equal(toUserMessage(new Error("请求超时")), "请求超时");
});

test("falls back to the error name when the message is empty", () => {
  const error = new Error("");
  error.name = "TimeoutError";
  assert.equal(toUserMessage(error), "TimeoutError");
});

test("unwraps a message property from a plain object", () => {
  assert.equal(toUserMessage({ message: "connection refused" }), "connection refused");
});

test("unwraps common serialized error keys", () => {
  assert.equal(toUserMessage({ error: "bad request" }), "bad request");
  assert.equal(toUserMessage({ msg: "nope" }), "nope");
  assert.equal(toUserMessage({ detail: "forbidden" }), "forbidden");
  assert.equal(toUserMessage({ reason: "conflict" }), "conflict");
});

test("unwraps a nested Tauri error object", () => {
  assert.equal(toUserMessage({ error: { message: "sqlite locked" } }), "sqlite locked");
});

test("never renders an unreadable object placeholder", () => {
  assert.notEqual(toUserMessage({}), "[object Object]");
  assert.notEqual(toUserMessage(new Object()), "[object Object]");
});

test("serializes an object without a known message key", () => {
  assert.equal(toUserMessage({ code: 503 }), '{"code":503}');
});

test("handles nullish and empty input with a fallback", () => {
  assert.equal(toUserMessage(null), "未知错误");
  assert.equal(toUserMessage(undefined), "未知错误");
  assert.equal(toUserMessage("   "), "未知错误");
});

test("handles primitives that carry meaning", () => {
  assert.equal(toUserMessage(404), "404");
  assert.equal(toUserMessage(false), "false");
});

test("survives circular structures", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(toUserMessage(circular), "未知错误");
});
