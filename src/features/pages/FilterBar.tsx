export function FilterBar({ filters, values, querying, zh, onChange, onQuery }: { filters: string[]; values: Record<string, string>; querying: boolean; zh: boolean; onChange: (name: string, value: string) => void; onQuery: () => void }) {
  return <div className="filter-row">{filters.map((filter) => <input key={filter} placeholder={filter} value={values[filter] || ""} onChange={(event) => onChange(filter, event.target.value)} />)}<button className="secondary" onClick={onQuery}>{querying ? (zh ? "加载中…" : "Loading…") : (zh ? "查询" : "Query")}</button></div>;
}
