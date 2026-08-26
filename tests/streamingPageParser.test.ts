import assert from "node:assert/strict";
import test from "node:test";
import type { PageSpec } from "../src/types/domain";
import { extractStructuredPageFields, repairModelJson } from "../src/features/pages/modelJsonRepair";
import { StreamingPageParser } from "../src/features/pages/streamingPageParser";

test("repair handles fences, JSONC comments, trailing commas, and truncated strings", () => {
  const source = `\`\`\`jsonc
  {
    // generated title
    "title": "Devices",
    "description": "A // literal URL https://example.test",
    "filters": [],
    "stats": [],
    "columns": ["Name",],
    "rows": [["Device A",],],
    /* view configuration */
    "views": [{"type":"list", "title":"All",}],
  }
  \`\`\``;
  const parsed = JSON.parse(repairModelJson(source)) as PageSpec;
  assert.equal(parsed.description, "A // literal URL https://example.test");
  assert.deepEqual(parsed.columns, ["Name"]);
  assert.equal(parsed.views?.[0].type, "list");

  const truncated = JSON.parse(repairModelJson('{"title":"Devices","description":"unfinished')) as Partial<PageSpec>;
  assert.equal(truncated.description, "unfinished");
});

test("structured fallback only exposes safely extracted user-readable fields", () => {
  assert.deepEqual(extractStructuredPageFields('{"title":"Devices","description":"Partial","rows":[broken'), {
    title: "Devices",
    description: "Partial",
  });
  assert.equal(extractStructuredPageFields("not json at all"), null);
});

test("streaming preview includes valid views and completes repaired PageSpec", () => {
  const deltas: Partial<PageSpec>[] = [];
  let completed: PageSpec | undefined;
  const parser = new StreamingPageParser({ onDelta: (partial) => deltas.push(partial), onComplete: (page) => { completed = page; } });
  parser.push('{"title":"Orders","description":"Trend","filters":[],"stats":[],"columns":["Date","Count"],"rows":[["2026-08-25","2"]],');
  parser.push('"views":[{"type":"chart","title":"Trend","chartType":"line","xAxisColumn":"Date","yAxisColumn":"Count"}],"interaction":{"create":"modal","detail":"modal"},}');
  parser.finish();
  assert.equal(completed?.title, "Orders");
  assert.equal(completed?.views?.[0].type, "chart");
  assert.equal(completed?.interaction?.create, "modal");
  assert.ok(deltas.some((partial) => partial.views?.[0]?.type === "chart"));
  assert.ok(deltas.some((partial) => partial.interaction?.detail === "modal"));
});

test("irreparable final response throws a readable retry message", () => {
  const parser = new StreamingPageParser({ onDelta: () => undefined, onComplete: () => undefined });
  parser.push('{"title":"Orders", broken');
  assert.throws(() => parser.finish(), /Orders.*请重试/);
});
