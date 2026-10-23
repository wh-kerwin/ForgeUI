import assert from "node:assert/strict";
import test from "node:test";
import type { PageSpec } from "../src/types/domain";
import {
  extractStructuredPageFields,
  repairModelJson,
} from "../src/features/pages/modelJsonRepair";
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

  const truncated = JSON.parse(
    repairModelJson('{"title":"Devices","description":"unfinished'),
  ) as Partial<PageSpec>;
  assert.equal(truncated.description, "unfinished");
});

test("structured fallback only exposes safely extracted user-readable fields", () => {
  assert.deepEqual(
    extractStructuredPageFields('{"title":"Devices","description":"Partial","rows":[broken'),
    {
      title: "Devices",
      description: "Partial",
    },
  );
  assert.equal(extractStructuredPageFields("not json at all"), null);
});

test("streaming preview includes valid views and completes repaired PageSpec", () => {
  const deltas: Partial<PageSpec>[] = [];
  let completed: PageSpec | undefined;
  const parser = new StreamingPageParser({
    onDelta: (partial) => deltas.push(partial),
    onComplete: (page) => {
      completed = page;
    },
  });
  parser.push(
    '{"title":"Orders","description":"Trend","filters":[],"stats":[],"columns":["Date","Count"],"rows":[["2026-08-25","2"]],',
  );
  parser.push(
    '"views":[{"type":"chart","title":"Trend","chartType":"line","xAxisColumn":"Date","yAxisColumn":"Count"}],"interaction":{"create":"modal","detail":"modal"},}',
  );
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

test("flush and destroy are no-ops when no coalesced partial exists", () => {
  const parser = new StreamingPageParser({
    coalesce: true,
    flushIntervalMs: 100,
    onDelta: () => undefined,
    onComplete: () => undefined,
  });
  assert.doesNotThrow(() => parser.flush());
  assert.doesNotThrow(() => parser.destroy());
});

type FakeScheduler = {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

function createFakeScheduler() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const scheduler: FakeScheduler = {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id) {
      timers.delete(id as unknown as number);
    },
  };
  return {
    scheduler,
    pendingCount: () => timers.size,
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort(([, left], [, right]) => left.due - right.due)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.due;
        timer.callback();
      }
      now = target;
    },
  };
}

function validPageJson(title = "Orders") {
  return JSON.stringify({
    title,
    description: "A generated page",
    filters: [],
    stats: [],
    columns: ["Name"],
    rows: [["Order"]],
  });
}

test("coalesces 1000 text fragments into one latest partial per 100ms window", () => {
  const clock = createFakeScheduler();
  const deltas: Partial<PageSpec>[] = [];
  const parser = new StreamingPageParser({
    coalesce: true,
    flushIntervalMs: 100,
    scheduler: clock.scheduler,
    onDelta: (partial) => deltas.push(partial),
    onComplete: () => undefined,
  });

  parser.push('{"title":"');
  for (let index = 0; index < 1000; index += 1) parser.push("x");

  assert.equal(clock.pendingCount(), 1);
  clock.advance(99);
  assert.equal(deltas.length, 0);
  clock.advance(1);
  assert.deepEqual(deltas, [{ title: "x".repeat(1000) }]);
  assert.equal(clock.pendingCount(), 0);
  clock.advance(500);
  assert.equal(deltas.length, 1);
});

test("schedules reentrant input after clearing the fired timer and pending partial", () => {
  const clock = createFakeScheduler();
  const deltas: Partial<PageSpec>[] = [];
  const parser = new StreamingPageParser({
    coalesce: true,
    flushIntervalMs: 100,
    scheduler: clock.scheduler,
    onDelta: (partial) => {
      deltas.push(partial);
      if (deltas.length === 1) parser.push(',"description":"received during callback"');
    },
    onComplete: () => undefined,
  });

  parser.push('{"title":"Orders"');
  clock.advance(100);
  assert.equal(clock.pendingCount(), 1);
  clock.advance(99);
  assert.equal(deltas.length, 1);
  clock.advance(1);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[1].description, "received during callback");
});

test("finish cancels a pending timer and completes at most once", () => {
  const clock = createFakeScheduler();
  let completeCount = 0;
  const parser = new StreamingPageParser({
    coalesce: true,
    flushIntervalMs: 100,
    scheduler: clock.scheduler,
    onDelta: () => undefined,
    onComplete: () => {
      completeCount += 1;
    },
  });

  parser.push(validPageJson());
  assert.equal(clock.pendingCount(), 1);
  parser.finish();
  parser.finish();
  clock.advance(500);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(completeCount, 1);
});

test("destroy closes the parser against push, flush, and pending timer callbacks", () => {
  const clock = createFakeScheduler();
  const deltas: Partial<PageSpec>[] = [];
  let completeCount = 0;
  const parser = new StreamingPageParser({
    coalesce: true,
    flushIntervalMs: 100,
    scheduler: clock.scheduler,
    onDelta: (partial) => deltas.push(partial),
    onComplete: () => {
      completeCount += 1;
    },
  });

  parser.push('{"title":"Draft"');
  parser.destroy();
  parser.push(validPageJson());
  parser.flush();
  parser.finish();
  clock.advance(500);
  assert.deepEqual(deltas, []);
  assert.equal(completeCount, 0);
});

test("final parsing handles split Unicode escapes and braces inside strings", () => {
  let completed: PageSpec | undefined;
  const parser = new StreamingPageParser({
    onDelta: () => undefined,
    onComplete: (page) => {
      completed = page;
    },
  });
  const source = String.raw`{"title":"订单 订单 \"{braces}\"","description":"Unicode 📦"`;
  const escaped = source.replace(
    "订单 订单",
    "订单 " + String.fromCharCode(92) + "u8BA2" + String.fromCharCode(92) + "u5355",
  );
  const splitAt = escaped.indexOf("\\u8BA2") + 3;
  assert.ok(splitAt > 3);
  parser.push(escaped.slice(0, splitAt));
  parser.push(escaped.slice(splitAt));
  parser.push(',"filters":[],"stats":[],"columns":[],"rows":[]}');
  parser.finish();
  assert.equal(completed?.title, '订单 订单 "{braces}"');
  assert.equal(completed?.description, "Unicode 📦");
});

test("an empty stream fails final parsing without completing", () => {
  let completeCount = 0;
  const parser = new StreamingPageParser({
    onDelta: () => undefined,
    onComplete: () => {
      completeCount += 1;
    },
  });
  assert.throws(() => parser.finish(), /结构不完整/);
  assert.equal(completeCount, 0);
});
