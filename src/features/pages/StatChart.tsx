import type { PageSpec } from "../../types/domain";

export function StatChart({ stats }: Pick<PageSpec, "stats">) {
  if (stats.length < 2) return null;
  const values = stats.map((stat) => Number(stat.value.replace(/[^0-9.-]/g, "")) || 0);
  const maximum = Math.max(...values, 1);
  return <div className="mini-chart">{stats.map((stat, index) => <div key={stat.label} className="chart-bar" style={{ height: `${Math.max(8, (values[index] / maximum) * 90)}%` }}><span>{stat.label}</span></div>)}</div>;
}
