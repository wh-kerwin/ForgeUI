import type { FieldSchema } from "../../types/domain";

export type FieldErrors = Record<string, string>;

export function isFieldVisible(field: FieldSchema, values: Record<string, string>): boolean {
  if (!field.visibleWhen) return true;
  const expected = Array.isArray(field.visibleWhen.equals)
    ? field.visibleWhen.equals
    : [field.visibleWhen.equals];
  return expected.includes(values[field.visibleWhen.field] ?? "");
}

export function visibleFieldSchemas(
  fields: FieldSchema[],
  values: Record<string, string>,
): FieldSchema[] {
  return fields.filter((field) => isFieldVisible(field, values));
}

/** Only declared fields are kept; extra keys from a stale form never reach the API. */
export function sanitizeFieldValues(
  fields: readonly FieldSchema[],
  values: Record<string, string>,
): Record<string, string> {
  const allowed = new Set(fields.map((field) => field.name));
  return Object.fromEntries(Object.entries(values).filter(([name]) => allowed.has(name))) as Record<
    string,
    string
  >;
}

function patternMatches(pattern: string, value: string): boolean {
  // Patterns come from an API document, not from a regex literal: bound the
  // length and never let an invalid expression break form submission.
  if (pattern.length > 200) return false;
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

export function validateField(field: FieldSchema, value: string, zh: boolean): string {
  if (field.required && value === "")
    return zh ? `${field.name} 为必填字段` : `${field.name} is required`;
  if (!value) return "";
  const constraints = field.constraints;
  if (field.type === "number" && !Number.isFinite(Number(value)))
    return zh ? `${field.name} 必须是数字` : `${field.name} must be a number`;
  if (field.type === "integer" && !Number.isInteger(Number(value)))
    return zh ? `${field.name} 必须是整数` : `${field.name} must be an integer`;
  if (field.type === "enum" && field.enumValues?.length && !field.enumValues.includes(value))
    return zh ? `请选择有效的 ${field.name}` : `Select a valid ${field.name}`;
  if (constraints) {
    const length = [...value].length;
    if (constraints.minLength !== undefined && length < constraints.minLength)
      return zh
        ? `${field.name} 至少需要 ${constraints.minLength} 个字符`
        : `${field.name} needs at least ${constraints.minLength} characters`;
    if (constraints.maxLength !== undefined && length > constraints.maxLength)
      return zh
        ? `${field.name} 最多 ${constraints.maxLength} 个字符`
        : `${field.name} allows at most ${constraints.maxLength} characters`;
    if (constraints.pattern && !patternMatches(constraints.pattern, value))
      return zh ? `${field.name} 格式不正确` : `${field.name} has an invalid format`;
    if (constraints.min !== undefined || constraints.max !== undefined) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric))
        return zh ? `${field.name} 必须是数字` : `${field.name} must be a number`;
      if (constraints.min !== undefined && numeric < constraints.min)
        return zh
          ? `${field.name} 不能小于 ${constraints.min}`
          : `${field.name} must be at least ${constraints.min}`;
      if (constraints.max !== undefined && numeric > constraints.max)
        return zh
          ? `${field.name} 不能大于 ${constraints.max}`
          : `${field.name} must be at most ${constraints.max}`;
    }
  }
  return "";
}

/**
 * Hidden and readonly fields are never serialized, and values for undeclared
 * fields are dropped. The caller keeps its input on failure (see MutationPanel).
 */
export function serializeFieldValues(
  fields: FieldSchema[],
  values: Record<string, string>,
  zh: boolean,
): { payload: string | null; errors: FieldErrors } {
  const active = visibleFieldSchemas(fields, values).filter(
    (field) => !field.constraints?.readonly,
  );
  const errors = Object.fromEntries(
    active
      .map((field) => [field.name, validateField(field, values[field.name] ?? "", zh)])
      .filter(([, error]) => error),
  ) as FieldErrors;
  if (Object.keys(errors).length) return { payload: null, errors };
  const payload: Record<string, unknown> = {};
  for (const field of active) {
    const raw = values[field.name] ?? "";
    if (!raw) continue;
    if (field.type === "number" || field.type === "integer") payload[field.name] = Number(raw);
    else if (field.type === "boolean") payload[field.name] = raw === "true";
    else payload[field.name] = raw;
  }
  return { payload: JSON.stringify(payload), errors: {} };
}
