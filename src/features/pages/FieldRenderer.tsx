import type { FieldSchema } from "../../types/domain";
import { Checkbox, Input, InputNumber, Select } from "antd";

export function FieldRenderer({
  field,
  value,
  onChange,
  onBlur,
  invalid = false,
}: {
  field: FieldSchema;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  const readonly = field.constraints?.readonly === true;
  const constraints = field.constraints;
  if (field.type === "enum") {
    return (
      <Select
        allowClear={!readonly}
        disabled={readonly}
        aria-label={field.name}
        value={value || undefined}
        placeholder={`请选择${field.name}`}
        status={invalid ? "error" : undefined}
        onBlur={onBlur}
        onChange={(next) => onChange(String(next ?? ""))}
        options={(field.enumValues ?? []).map((option) => ({ value: option, label: option }))}
      />
    );
  }
  if (field.type === "boolean")
    return (
      <Checkbox
        checked={value === "true"}
        disabled={readonly}
        onBlur={onBlur}
        onChange={(event) => onChange(String(event.target.checked))}
      >
        {field.name}
      </Checkbox>
    );
  if (field.type === "number" || field.type === "integer")
    return (
      <InputNumber
        value={value === "" ? null : Number(value)}
        precision={field.type === "integer" ? 0 : undefined}
        min={constraints?.min}
        max={constraints?.max}
        disabled={readonly}
        aria-label={field.name}
        status={invalid ? "error" : undefined}
        onBlur={onBlur}
        onChange={(next) => onChange(next === null ? "" : String(next))}
      />
    );
  return (
    <Input
      value={value}
      type={field.type === "date" ? "date" : "text"}
      aria-label={field.name}
      required={field.required}
      readOnly={readonly}
      disabled={readonly}
      maxLength={constraints?.maxLength}
      minLength={constraints?.minLength}
      pattern={constraints?.pattern}
      title={field.description}
      status={invalid ? "error" : undefined}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
