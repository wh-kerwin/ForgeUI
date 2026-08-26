import type { FieldSchema } from "../../types/domain";
import type { ChangeEvent } from "react";
import { SelectField } from "../../components/SelectField";

export function FieldRenderer({ field, value, onChange, onBlur, invalid = false }: { field: FieldSchema; value: string; onChange: (value: string) => void; onBlur?: () => void; invalid?: boolean }) {
  const common = { value, required: field.required, title: field.description, "aria-invalid": invalid || undefined, onBlur, onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value) };
  if (field.type === "enum") {
    return <SelectField value={value} options={[{ value: "", label: `请选择${field.name}` }, ...(field.enumValues ?? []).map((option) => ({ value: option, label: option }))]} onChange={onChange} onBlur={onBlur} ariaLabel={field.name} required={field.required} invalid={invalid} title={field.description} />;
  }
  const inputType = field.type === "date" ? "date" : field.type === "number" || field.type === "integer" ? "number" : field.type === "boolean" ? "checkbox" : "text";
  if (inputType === "checkbox") return <input type="checkbox" checked={value === "true"} required={field.required} aria-invalid={invalid || undefined} title={field.description} onBlur={onBlur} onChange={(event) => onChange(String(event.target.checked))} />;
  return <input {...common} type={inputType} step={field.type === "integer" ? 1 : undefined} />;
}
