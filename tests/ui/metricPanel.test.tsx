import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsPanel } from "../../src/features/pages/StatsPanel";
import type { DisplayStat } from "../../src/features/pages/runtime/runtimeSelectors";

const uiTest = (name: string, body: () => void) => it(name, body, 60_000);

function stat(overrides: Partial<DisplayStat>): DisplayStat {
  return {
    label: "Metric",
    value: "—",
    scope: "currentPage",
    note: "note",
    ...overrides,
  };
}

describe("E1 metric scope presentation", () => {
  uiTest("labels current-page and server scopes without inventing a whole-dataset total", () => {
    const { container } = render(
      <StatsPanel
        stats={[
          stat({
            label: "Page count",
            value: "3",
            state: "success",
            note: "仅当前已加载页（3 条）",
          }),
          stat({
            label: "Total",
            scope: "serverAggregate",
            state: "pending",
            note: "统计端点已绑定，等待执行查询",
          }),
        ]}
      />,
    );
    expect(screen.getByText("仅当前页")).toBeTruthy();
    expect(screen.getByText("服务端聚合")).toBeTruthy();
    expect(screen.getByText("等待执行")).toBeTruthy();
    expect(container.querySelector('[data-state="pending"]')).not.toBeNull();
    expect(container.querySelector('[data-scope="serverAggregate"]')).not.toBeNull();
  });

  uiTest("unbound and failed metrics keep explicit error regions and are never zero", () => {
    const { container } = render(
      <StatsPanel
        stats={[
          stat({
            label: "Unbound",
            scope: "serverAggregate",
            state: "unbound",
            note: "未绑定统计端点，不显示全库数值",
          }),
          stat({ label: "Failed", state: "error", invalid: true, note: "统计端点超时" }),
          stat({ label: "Good", value: "42", state: "success", note: "仅当前已加载页" }),
        ]}
      />,
    );
    expect(screen.getByText("未绑定")).toBeTruthy();
    expect(screen.getByText("统计失败")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(container.querySelector('[data-state="error"]')).not.toBeNull();
    expect(screen.getByText(/未就绪或失败/)).toBeTruthy();
  });

  uiTest("truncation is visible next to the current-page value", () => {
    render(
      <StatsPanel
        stats={[
          stat({
            label: "Page sum",
            value: "60",
            state: "success",
            truncated: true,
            note: "仅当前已加载页（结果已截断）",
          }),
          stat({ label: "Other", value: "12", state: "success", note: "仅当前已加载页" }),
        ]}
      />,
    );
    expect(screen.getByText("结果已截断，不代表全量")).toBeTruthy();
    expect(screen.getByText("60")).toBeTruthy();
  });
});
