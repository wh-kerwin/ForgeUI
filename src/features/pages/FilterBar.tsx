import { Button, Form, Input } from "antd";
import { RotateCcw, Search } from "lucide-react";

export function FilterBar({ filters, values, querying, zh, onChange, onQuery, onReset }: { filters: string[]; values: Record<string, string>; querying: boolean; zh: boolean; onChange: (name: string, value: string) => void; onQuery: () => void; onReset: () => void }) {
  return <Form className="filter-row" layout="vertical" onFinish={onQuery}>
    <div className="filter-fields">
      {filters.map((filter) => <Form.Item key={filter} label={filter}>
        <Input allowClear placeholder={zh ? `请输入${filter}` : `Enter ${filter}`} value={values[filter] || ""} onChange={(event) => onChange(filter, event.target.value)} />
      </Form.Item>)}
    </div>
    <div className="filter-actions">
      <Button type="primary" htmlType="submit" icon={<Search size={15} />} loading={querying}>{zh ? "查询" : "Query"}</Button>
      <Button htmlType="button" icon={<RotateCcw size={15} />} onClick={onReset}>{zh ? "重置" : "Reset"}</Button>
    </div>
  </Form>;
}
