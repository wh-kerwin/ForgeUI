import type { PageSpec } from "../../types/domain";

export function normalizeModelJsonText(source: string): string {
  const withoutFence = source.replace(/^\s*```(?:json|jsonc)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = withoutFence.indexOf("{");
  return start >= 0 ? withoutFence.slice(start) : withoutFence;
}

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        output += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (character === "\n" || character === "\r") output += character;
      continue;
    }
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else output += character;
  }
  return output;
}

function stripTrailingCommas(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") continue;
    }
    output += character;
  }
  return output;
}

export function repairModelJson(source: string): string {
  const cleaned = stripTrailingCommas(stripJsonComments(normalizeModelJsonText(source)));
  let output = "";
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const character of cleaned) {
    output += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") closers.push("}");
    else if (character === "[") closers.push("]");
    else if (character === "}" || character === "]") {
      if (closers[closers.length - 1] === character) closers.pop();
    }
  }

  if (inString) output += escaped ? '\\"' : '"';
  output = output.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  return stripTrailingCommas(output + closers.reverse().join(""));
}

function extractStringField(source: string, field: string): string | undefined {
  const match = source.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`));
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

export function extractStructuredPageFields(source: string): Partial<PageSpec> | null {
  const normalized = normalizeModelJsonText(source);
  const title = extractStringField(normalized, "title");
  const description = extractStringField(normalized, "description");
  if (!title && !description) return null;
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
}
