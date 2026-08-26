import type { PageView } from "../../types/domain";

const CHART_COLORS = [
  "var(--fg-primary, #d5fa61)",
  "var(--fg-chart-2, #168aad)",
  "var(--fg-chart-3, #f59e0b)",
  "var(--fg-chart-4, #e85d75)",
  "var(--fg-chart-5, #8b5cf6)",
  "var(--fg-chart-6, #2a9d8f)",
];

function pieArc(start: number, end: number) {
  const point = (angle: number) => ({
    x: 320 + 78 * Math.cos(angle - Math.PI / 2),
    y: 112 + 78 * Math.sin(angle - Math.PI / 2),
  });
  const from = point(start);
  const to = point(end);
  return `M 320 112 L ${from.x} ${from.y} A 78 78 0 ${end - start > Math.PI ? 1 : 0} 1 ${to.x} ${to.y} Z`;
}

export function ChartPageView({
  view,
  columns,
  rows,
}: {
  view: Extract<PageView, { type: "chart" }>;
  columns: string[];
  rows: string[][];
}) {
  const x = columns.indexOf(view.xAxisColumn);
  const y = columns.indexOf(view.yAxisColumn);
  const groupIndex = view.groupByColumn
    ? columns.indexOf(view.groupByColumn)
    : -1;
  if (x < 0 || y < 0)
    return (
      <div className="empty-view">
        找不到图表字段：{view.xAxisColumn} / {view.yAxisColumn}
      </div>
    );
  const source = rows
    .slice(0, 24)
    .map((row) => ({ row, value: Number(row[y]) }))
    .filter(({ value }) => Number.isFinite(value));
  if (!source.length)
    return <div className="empty-view">图表字段没有可用的数值数据</div>;
  const max = Math.max(1, ...source.map(({ value }) => Math.abs(value)));
  const groups = [
    ...new Set(
      source.map(({ row }) =>
        groupIndex >= 0 ? row[groupIndex] || "未分组" : "数据",
      ),
    ),
  ];
  const points = source.map(({ row, value }, index) => ({
    x: 48 + index * (552 / Math.max(1, source.length - 1)),
    y: 190 - Math.max(2, (Math.abs(value) / max) * 150),
    label: String(row[x] ?? "").slice(0, 8),
    group: groupIndex >= 0 ? row[groupIndex] || "未分组" : "数据",
    value,
  }));
  let content: React.ReactNode;
  if (view.chartType === "pie") {
    const total = points.reduce((sum, point) => sum + Math.abs(point.value), 0);
    let cursor = 0;
    content = points.map((point, index) => {
      const start = cursor;
      cursor += total ? (Math.abs(point.value) / total) * Math.PI * 2 : 0;
      return (
        <path
          key={index}
          d={pieArc(start, cursor)}
          fill={CHART_COLORS[index % CHART_COLORS.length]}
        >
          <title>
            {point.label}: {point.value}
          </title>
        </path>
      );
    });
  } else if (view.chartType === "line") {
    content = groups.map((group, index) => (
      <polyline
        key={group}
        points={points
          .filter((point) => point.group === group)
          .map((point) => `${point.x},${point.y}`)
          .join(" ")}
        fill="none"
        stroke={CHART_COLORS[index % CHART_COLORS.length]}
        strokeWidth="3"
      />
    ));
  } else {
    content = points.map((point, index) => (
      <rect
        key={index}
        x={point.x - 7}
        y={point.y}
        width="14"
        height={190 - point.y}
        rx="2"
        fill={CHART_COLORS[groups.indexOf(point.group) % CHART_COLORS.length]}
      >
        <title>
          {point.label}: {point.value}
        </title>
      </rect>
    ));
  }
  return (
    <div className="page-chart-view">
      <div className="chart-heading">
        <h4>{view.title}</h4>
        {groupIndex >= 0 && (
          <div className="chart-legend">
            {groups.map((group, index) => (
              <span key={group}>
                <i
                  style={{
                    background: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
                {group}
              </span>
            ))}
          </div>
        )}
      </div>
      <svg viewBox="0 0 640 220" role="img" aria-label={view.title}>
        {view.chartType !== "pie" && (
          <line
            x1="36"
            y1="190"
            x2="620"
            y2="190"
            stroke="currentColor"
            opacity=".4"
          />
        )}
        {content}
        {view.chartType !== "pie" &&
          points.map((point, index) => (
            <text
              key={`label-${index}`}
              x={point.x}
              y="208"
              textAnchor="middle"
            >
              {point.label}
            </text>
          ))}
      </svg>
    </div>
  );
}
