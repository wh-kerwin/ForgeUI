import { StatChart } from "./StatChart";
import type { DisplayStat } from "./runtime/runtimeSelectors";

const scopeLabels: Record<DisplayStat["scope"], [string, string]> = {
  currentPage: ["仅当前页", "Current page"],
  serverAggregate: ["服务端聚合", "Server aggregate"],
  definition: ["定义示例", "Definition sample"],
  unloaded: ["待加载", "Not loaded"],
};

const stateLabels: Record<NonNullable<DisplayStat["state"]>, [string, string]> = {
  success: ["", ""],
  loading: ["加载中", "Loading"],
  pending: ["等待执行", "Awaiting query"],
  empty: ["无数据", "No data"],
  error: ["统计失败", "Statistics failed"],
  unbound: ["未绑定", "Unbound"],
  invalid: ["定义无效", "Invalid definition"],
};

export function StatsPanel({ stats, zh = true }: { stats: DisplayStat[]; zh?: boolean }) {
  const language = zh ? 0 : 1;
  return (
    <>
      <div className="stats-row">
        {stats.map((stat) => {
          const state = stat.state ?? "success";
          return (
            <div className="stat-card" key={stat.label} data-scope={stat.scope} data-state={state}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small className="muted">{stat.note}</small>
              <span className="stat-scope">{scopeLabels[stat.scope][language]}</span>
              {state !== "success" && (
                <small role="status" className="stat-state">
                  {stateLabels[state][language]}
                </small>
              )}
              {stat.truncated && (
                <small role="status" className="muted">
                  {zh ? "结果已截断，不代表全量" : "Truncated; not a full dataset"}
                </small>
              )}
              {stat.invalid && (
                <small role="status" className="muted">
                  {zh
                    ? "该指标值无法解析为数字，图表区域已标注"
                    : "Value is not numeric; the chart region is marked"}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <StatChart stats={stats} zh={zh} />
    </>
  );
}
