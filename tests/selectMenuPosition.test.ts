import assert from "node:assert/strict";
import test from "node:test";
import { getSelectMenuLayout } from "../src/components/selectMenuPosition";

const viewport = { left: 0, top: 0, width: 320, height: 480 };

test("select menu keeps the trigger width on a narrow viewport", () => {
  const layout = getSelectMenuLayout({
    trigger: { left: 55, top: 220, right: 240, bottom: 246, width: 185 },
    viewport,
    optionCount: 4,
  });
  assert.equal(layout.width, 185);
  assert.equal(layout.left, 55);
  assert.ok(layout.left + layout.width <= viewport.width - 8);
});

test("select menu shifts inside the right edge instead of being clipped", () => {
  const layout = getSelectMenuLayout({
    trigger: { left: 260, top: 120, right: 480, bottom: 146, width: 220 },
    viewport,
    optionCount: 4,
  });
  assert.equal(layout.width, 220);
  assert.equal(layout.left, 92);
  assert.equal(layout.left + layout.width, 312);
});

test("select menu shrinks to remain visible in an extremely narrow client", () => {
  const tinyViewport = { left: 0, top: 0, width: 120, height: 240 };
  const layout = getSelectMenuLayout({
    trigger: { left: 20, top: 80, right: 200, bottom: 106, width: 180 },
    viewport: tinyViewport,
    optionCount: 6,
  });
  assert.equal(layout.left, 8);
  assert.equal(layout.width, 104);
  assert.ok(layout.maxHeight > 0);
  assert.ok(layout.top >= 8);
  assert.ok(layout.top + layout.maxHeight <= 232);
});

test("select menu opens upward when the lower edge has less room", () => {
  const layout = getSelectMenuLayout({
    trigger: { left: 30, top: 430, right: 210, bottom: 456, width: 180 },
    viewport,
    optionCount: 5,
  });
  assert.ok(layout.top < 430);
  assert.ok(layout.top >= 8);
  assert.ok(layout.top + layout.maxHeight <= 472);
});
