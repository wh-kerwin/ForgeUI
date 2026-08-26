import { StatChart } from "./StatChart";
import type { PageSpec } from "../../types/domain";

export function StatsPanel({ stats }: { stats: PageSpec["stats"] }) {
  return <><div className="stats-row">{stats.map((stat) => <div className="stat-card" key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}</div><StatChart stats={stats} /></>;
}
