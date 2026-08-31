import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { PageSpec } from "../../types/domain";

export function StatChart({ stats }: Pick<PageSpec, "stats">) {
  if (stats.length < 2) return null;
  const data = stats.map((stat) => ({
    label: stat.label,
    value: Number(stat.value.replace(/[^0-9.-]/g, "")) || 0,
  }));
  return (
    <div className="mini-chart" aria-label="指标对比图">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--fg-text-muted, #8290a3)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--fg-surface-control, #101720)" }}
            contentStyle={{
              background: "var(--fg-surface-alt, #121923)",
              border: "1px solid var(--fg-border, #273241)",
              borderRadius: 6,
            }}
          />
          <Bar dataKey="value" fill="var(--fg-primary, #d5fa61)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
