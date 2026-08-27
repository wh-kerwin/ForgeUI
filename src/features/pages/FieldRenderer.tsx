import type { FieldSchema } from "../../types/domain";
import { Checkbox, Input, InputNumber, Select } from "antd";

export function FieldRenderer({ field, value, onChange, onBlur, invalid = false }: { field: FieldSchema; value: string; onChange: (value: string) => void; onBlur?: () => void; invalid?: boolean }) {
  if (field.type === "enum") {
    return <Select allowClear value={value || undefined} placeholder={`请选择${field.name}`} status={invalid ? "error" : undefined} onBlur={onBlur} onChange={(next) => onChange(String(next ?? ""))} options={(field.enumValues ?? []).map((option) => ({ value: option, label: option }))} />;
  }
  if (field.type === "boolean") return <Checkbox checked={value === "true"} onBlur={onBlur} onChange={(event) => onChange(String(event.target.checked))}>{field.name}</Checkbox>;
  if (field.type === "number" || field.type === "integer") return <InputNumber value={value === "" ? null : Number(value)} precision={field.type === "integer" ? 0 : undefined} status={invalid ? "error" : undefined} onBlur={onBlur} onChange={(next) => onChange(next === null ? "" : String(next))} />;
  return <Input value={value} type={field.type === "date" ? "date" : "text"} required={field.required} title={field.description} status={invalid ? "error" : undefined} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} />;
}
