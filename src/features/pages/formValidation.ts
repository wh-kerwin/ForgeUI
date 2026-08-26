import type { FieldSchema } from "../../types/domain";

export type FieldErrors = Record<string, string>;

export function isFieldVisible(field: FieldSchema, values: Record<string, string>): boolean {
  if (!field.visibleWhen) return true;
  const expected = Array.isArray(field.visibleWhen.equals) ? field.visibleWhen.equals : [field.visibleWhen.equals];
  return expected.includes(values[field.visibleWhen.field] ?? "");
}

export function visibleFieldSchemas(fields: FieldSchema[], values: Record<string, string>): FieldSchema[] {
  return fields.filter((field) => isFieldVisible(field, values));
}

export function validateField(field: FieldSchema, value: string, zh: boolean): string {
  if (field.required && value === "") return zh ? `${field.name} 为必填字段` : `${field.name} is required`;
  if (!value) return "";
  if (field.type === "number" && !Number.isFinite(Number(value))) return zh ? `${field.name} 必须是数字` : `${field.name} must be a number`;
  if (field.type === "integer" && !Number.isInteger(Number(value))) return zh ? `${field.name} 必须是整数` : `${field.name} must be an integer`;
  if (field.type === "enum" && field.enumValues?.length && !field.enumValues.includes(value)) return zh ? `请选择有效的 ${field.name}` : `Select a valid ${field.name}`;
  return "";
}

export function serializeFieldValues(fields: FieldSchema[], values: Record<string, string>, zh: boolean): { payload: string | null; errors: FieldErrors } {
  const payload: Record<string, unknown> = {};
  const errors = Object.fromEntries(fields.map((field) => [field.name, validateField(field, values[field.name] ?? "", zh)]).filter(([, error]) => error)) as FieldErrors;
  if (Object.keys(errors).length) return { payload: null, errors };
  for (const field of fields) {
    const raw = values[field.name] ?? "";
    if (!raw) continue;
    if (field.type === "number" || field.type === "integer") payload[field.name] = Number(raw);
    else if (field.type === "boolean") payload[field.name] = raw === "true";
    else payload[field.name] = raw;
  }
  return { payload: JSON.stringify(payload), errors: {} };
}
