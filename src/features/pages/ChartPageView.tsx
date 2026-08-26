import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PageView } from "../../types/domain";

const CHART_COLORS = ["#1677ff", "#13a8a8", "#fa8c16", "#eb2f96", "#722ed1", "#52c41a"];
type ChartDatum = { label: string; value: number; group: string };

function chartData(rows: string[][], columns: string[], view: Extract<PageView, { type: "chart" }>) {
  const xIndex = columns.indexOf(view.xAxisColumn);
  const yIndex = columns.indexOf(view.yAxisColumn);
  const groupIndex = view.groupByColumn ? columns.indexOf(view.groupByColumn) : -1;
  if (xIndex < 0 || yIndex < 0) return { error: `找不到图表字段：${view.xAxisColumn} / ${view.yAxisColumn}`, source: [] as ChartDatum[], series: [] as string[], data: [] as Record<string, string | number>[] };

  const source = rows.slice(0, 100).map((row) => ({
    label: String(row[xIndex] ?? "").slice(0, 32),
    value: Number(String(row[yIndex] ?? "").replace(/[^0-9.-]/g, "")),
    group: groupIndex >= 0 ? String(row[groupIndex] || "未分组") : view.yAxisColumn,
  })).filter((point) => Number.isFinite(point.value));
  if (!source.length) return { error: "图表字段没有可用的数值数据", source, series: [], data: [] as Record<string, string | number>[] };

  const series = [...new Set(source.map((point) => point.group))];
  const pivot = new Map<string, Record<string, string | number>>();
  source.forEach((point) => {
    const row = pivot.get(point.label) ?? { label: point.label };
    row[point.group] = Number(row[point.group] ?? 0) + point.value;
    pivot.set(point.label, row);
  });
  return { error: null, source, series, data: [...pivot.values()] };
}

export function ChartPageView({ view, columns, rows }: { view: Extract<PageView, { type: "chart" }>; columns: string[]; rows: string[][] }) {
  const { error, source, series, data } = chartData(rows, columns, view);
  if (error) return <div className="empty-view">{error}</div>;

  const common = <>
    <CartesianGrid vertical={false} stroke="var(--fg-border, #273241)" strokeDasharray="3 3" />
    <XAxis dataKey="label" tick={{ fill: "var(--fg-text-muted, #8290a3)", fontSize: 11 }} axisLine={false} tickLine={false} />
    <YAxis tick={{ fill: "var(--fg-text-muted, #8290a3)", fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
    <Tooltip contentStyle={{ background: "var(--fg-surface-alt, #121923)", border: "1px solid var(--fg-border, #273241)", borderRadius: 6, color: "var(--fg-text, #e9edf5)" }} />
    {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
  </>;

  return <section className="page-chart-view" aria-label={view.title}>
    <div className="chart-heading"><h4>{view.title}</h4><span>{view.chartType === "pie" ? `${source.length} 项构成` : `${source.length} 条数据`}</span></div>
    <div className="chart-canvas"><ResponsiveContainer width="100%" height="100%">
      {view.chartType === "pie" ? <PieChart>
        <Tooltip contentStyle={{ background: "var(--fg-surface-alt, #121923)", border: "1px solid var(--fg-border, #273241)", borderRadius: 6 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Pie data={source} dataKey="value" nameKey="label" innerRadius="54%" outerRadius="82%" paddingAngle={2}>{source.map((point, index) => <Cell key={`${point.label}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie>
      </PieChart> : view.chartType === "line" ? <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>{common}{series.map((name, index) => <Line key={name} type="monotone" dataKey={name} name={name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}</LineChart> : <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>{common}{series.map((name, index) => <Bar key={name} dataKey={name} name={name} fill={CHART_COLORS[index % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />)}</BarChart>}
    </ResponsiveContainer></div>
  </section>;
}
