import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { DisplayStat } from "./runtime/runtimeSelectors";

export function StatChart({ stats, zh = true }: { stats: DisplayStat[]; zh?: boolean }) {
  const usable: { label: string; value: number }[] = [];
  let unparsable = 0;
  for (const stat of stats) {
    // "—" means the value was never loaded; it is not a formatting error.
    if (stat.value === "—") continue;
    const cleaned = stat.value.replace(/[^0-9.-]/g, "");
    const value = Number(cleaned);
    if (cleaned === "" || !Number.isFinite(value) || stat.invalid) {
      unparsable++;
      continue;
    }
    usable.push({ label: stat.label, value });
  }
  // A style/format error only affects this region and is reported, not hidden.
  if (usable.length < 2) {
    return unparsable > 0 ? (
      <div
        className="mini-chart"
        role="status"
        aria-label={zh ? "指标对比图" : "Metric comparison chart"}
      >
        {zh
          ? `${unparsable} 个指标值无法解析为数字，图表已跳过；其余区域不受影响`
          : `${unparsable} metric values are not numeric; chart skipped, other regions unaffected`}
      </div>
    ) : null;
  }
  return (
    <div className="mini-chart" aria-label={zh ? "指标对比图" : "Metric comparison chart"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={usable} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
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
