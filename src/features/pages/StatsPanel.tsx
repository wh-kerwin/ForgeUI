import { StatChart } from "./StatChart";
import type { DisplayStat } from "./runtime/runtimeSelectors";

export function StatsPanel({ stats, zh = true }: { stats: DisplayStat[]; zh?: boolean }) {
  return (
    <>
      <div className="stats-row">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label} data-scope={stat.scope}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <small className="muted">{stat.note}</small>
            {stat.invalid && (
              <small role="status" className="muted">
                {zh
                  ? "该指标值无法解析为数字，图表区域已标注"
                  : "Value is not numeric; the chart region is marked"}
              </small>
            )}
          </div>
        ))}
      </div>
      <StatChart stats={stats} zh={zh} />
    </>
  );
}
