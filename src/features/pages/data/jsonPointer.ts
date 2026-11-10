/**
 * RFC 6901 JSON Pointer parsing and safe, data-free traversal.
 *
 * Only literal segment access is implemented: no eval, no expressions,
 * no wildcard expansion and no prototype-chain lookups. Every failure is
 * reported as a stable issue code that never contains a response value.
 */

type ParseResult = { segments: string[]; error?: string };
type ReadResult = { found: boolean; value?: unknown; issue?: string };

/** Stable, data-free diagnostic codes. */
const SYNTAX = "pointer.syntax";
const UNSAFE = "pointer.unsafe";
const MISSING = "pointer.missing";
const TRAVERSAL = "pointer.traversal";

const UNSAFE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
/** Non-negative integer index without leading zeros. */
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/** Only JSON objects (Object.prototype or null prototype) are containers. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

/**
 * Validates and decodes one pointer segment.
 * Decoding order is fixed by RFC 6901: `~1` -> "/" first, then `~0` -> "~".
 * Returns null when a `~` is not followed by `0` or `1`.
 */
function decodeSegment(segment: string): string | null {
  for (let index = 0; index < segment.length; index += 1) {
    if (segment[index] !== "~") continue;
    const next = segment[index + 1];
    if (next !== "0" && next !== "1") return null;
    index += 1; // consume the escaped character
  }
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Parses an RFC 6901 pointer into decoded segments.
 * `""` addresses the root value; any non-empty pointer must start with "/".
 * Unsafe prototype segments are rejected case-insensitively.
 */
export function parsePointer(pointer: string): ParseResult {
  if (typeof pointer !== "string") return { segments: [], error: SYNTAX };
  if (pointer === "") return { segments: [] };
  if (!pointer.startsWith("/")) return { segments: [], error: SYNTAX };

  const segments: string[] = [];
  for (const raw of pointer.slice(1).split("/")) {
    const decoded = decodeSegment(raw);
    if (decoded === null) return { segments: [], error: SYNTAX };
    if (UNSAFE_SEGMENTS.has(decoded.toLowerCase())) {
      return { segments: [], error: UNSAFE };
    }
    segments.push(decoded);
  }
  return { segments };
}

/**
 * Reads a value at `pointer` without ever throwing on malformed input.
 * Intermediate values may only be plain objects or arrays; array segments
 * must be non-negative integer indices without leading zeros.
 */
export function readPointer(value: unknown, pointer: string): ReadResult {
  const parsed = parsePointer(pointer);
  if (parsed.error) return { found: false, issue: parsed.error };

  let current: unknown = value;
  for (const segment of parsed.segments) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(segment)) return { found: false, issue: SYNTAX };
      const index = Number(segment);
      if (index >= current.length) return { found: false, issue: MISSING };
      current = current[index];
      continue;
    }
    if (isPlainObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { found: false, issue: MISSING };
      }
      current = current[segment];
      continue;
    }
    return { found: false, issue: TRAVERSAL };
  }
  return { found: true, value: current };
}
