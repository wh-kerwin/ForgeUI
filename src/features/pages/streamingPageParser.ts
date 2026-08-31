import type { PageSpec } from "../../types/domain";
import { isPageView, parsePageSpec } from "./parsePageSpec";
import {
  extractStructuredPageFields,
  normalizeModelJsonText,
  repairModelJson,
} from "./modelJsonRepair";

type StreamingPageParserOptions = {
  onDelta: (partial: Partial<PageSpec>) => void;
  onComplete: (spec: PageSpec) => void;
  mode?: "modelText" | "sse";
};

/**
 * Accumulates model text (or raw SSE data events) and exposes safe PageSpec
 * fragments while the top-level JSON document is still being written.
 */
export class StreamingPageParser {
  private buffer = "";
  private sseBuffer = "";
  private transportMode: "modelText" | "sse";
  private readonly onComplete: (spec: PageSpec) => void;
  private readonly onDelta: (partial: Partial<PageSpec>) => void;

  constructor({ onDelta, onComplete, mode = "modelText" }: StreamingPageParserOptions) {
    this.onDelta = onDelta;
    this.onComplete = onComplete;
    this.transportMode = mode;
  }

  push(chunk: string): void {
    if (!chunk) return;
    if (this.transportMode === "sse") {
      this.pushSse(chunk);
      return;
    }
    this.pushModelText(chunk);
  }

  finish(): void {
    if (this.sseBuffer.trim()) this.consumeSseLine(this.sseBuffer.trimEnd());
    const complete = parsePageSpec(this.parseJson(repairModelJson(this.normalizedBuffer())));
    if (!complete) {
      const fallback = extractStructuredPageFields(this.normalizedBuffer());
      const title = fallback?.title ? `“${fallback.title}”` : "PageSpec";
      throw new Error(`模型返回的${title}结构不完整，请重试或简化生成要求`);
    }
    this.onComplete(complete);
  }

  private pushSse(chunk: string): void {
    this.sseBuffer += chunk;
    const lines = this.sseBuffer.split(/\r?\n/);
    this.sseBuffer = lines.pop() ?? "";
    lines.forEach((line) => this.consumeSseLine(line));
  }

  private consumeSseLine(line: string): void {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") return;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      const delta = this.extractEventText(event);
      if (delta) this.pushModelText(delta);
    } catch {
      // A malformed/incomplete event cannot safely contribute to a preview.
      // The backend remains authoritative and rejects malformed final streams.
    }
  }

  private extractEventText(event: Record<string, unknown>): string {
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    const delta = choice?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string") return delta.content;
    if (typeof choice?.text === "string") return choice.text;
    const anthropicDelta = event.delta as Record<string, unknown> | undefined;
    return typeof anthropicDelta?.text === "string" ? anthropicDelta.text : "";
  }

  private pushModelText(chunk: string): void {
    this.buffer += chunk;
    const normalized = this.normalizedBuffer();
    const parsed = this.parseJson(repairModelJson(normalized));
    const partial = this.toPartialPageSpec(parsed) ?? extractStructuredPageFields(normalized);
    if (partial) this.onDelta(partial);
  }

  private normalizedBuffer(): string {
    return normalizeModelJsonText(this.buffer);
  }

  private parseJson(source: string): unknown {
    if (!source.trim()) return null;
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }

  private toPartialPageSpec(value: unknown): Partial<PageSpec> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const partial: Partial<PageSpec> = {};
    if (typeof record.version === "number") partial.version = record.version;
    if (typeof record.title === "string") partial.title = record.title;
    if (typeof record.description === "string") partial.description = record.description;
    if (["sidebar", "full", "modal"].includes(String(record.layout)))
      partial.layout = record.layout as PageSpec["layout"];
    if (Array.isArray(record.breadcrumb))
      partial.breadcrumb = record.breadcrumb.filter(
        (item): item is string => typeof item === "string",
      );
    if (typeof record.permissionRole === "string") partial.permissionRole = record.permissionRole;
    if (typeof record.createdAt === "string") partial.createdAt = record.createdAt;
    if (typeof record.updatedAt === "string") partial.updatedAt = record.updatedAt;
    if (Array.isArray(record.filters))
      partial.filters = record.filters.filter((item): item is string => typeof item === "string");
    if (Array.isArray(record.columns))
      partial.columns = record.columns.filter((item): item is string => typeof item === "string");
    if (Array.isArray(record.stats)) {
      partial.stats = record.stats.filter(
        (item): item is { label: string; value: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).label === "string" &&
          typeof (item as Record<string, unknown>).value === "string",
      );
    }
    if (Array.isArray(record.rows)) {
      partial.rows = record.rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.filter((cell): cell is string => typeof cell === "string"));
    }
    if (Array.isArray(record.views)) partial.views = record.views.filter(isPageView);
    if (Array.isArray(record.columnMeta))
      partial.columnMeta = record.columnMeta.filter(
        (meta): meta is NonNullable<PageSpec["columnMeta"]>[number] =>
          Boolean(meta) &&
          typeof meta === "object" &&
          !Array.isArray(meta) &&
          typeof (meta as Record<string, unknown>).name === "string" &&
          ["string", "number", "date", "datetime", "enum", "boolean", "money"].includes(
            String((meta as Record<string, unknown>).type),
          ),
      );
    if (
      record.interaction &&
      typeof record.interaction === "object" &&
      !Array.isArray(record.interaction)
    ) {
      const modes = Object.fromEntries(
        Object.entries(record.interaction as Record<string, unknown>).filter(
          ([key, mode]) =>
            ["create", "update", "delete", "detail"].includes(key) &&
            ["modal", "drawer", "inline", "redirect"].includes(String(mode)),
        ),
      );
      if (Object.keys(modes).length) partial.interaction = modes as PageSpec["interaction"];
    }
    if (Array.isArray(record.batchActions))
      partial.batchActions = record.batchActions.filter(
        (action): action is NonNullable<PageSpec["batchActions"]>[number] =>
          Boolean(action) &&
          typeof action === "object" &&
          !Array.isArray(action) &&
          typeof (action as Record<string, unknown>).operation_id === "string" &&
          ["POST", "DELETE"].includes(String((action as Record<string, unknown>).method)),
      );
    if (
      ["forge-default", "enterprise-blue", "clean-light", "minimal-dark", "custom"].includes(
        String(record.theme),
      )
    )
      partial.theme = record.theme as PageSpec["theme"];
    if (
      record.styleTokens &&
      typeof record.styleTokens === "object" &&
      !Array.isArray(record.styleTokens)
    )
      partial.styleTokens = record.styleTokens as PageSpec["styleTokens"];
    return Object.keys(partial).length > 0 ? partial : null;
  }
}

export function previewPageSpec(partial: Partial<PageSpec>): PageSpec {
  const columns = partial.columns ?? [];
  const rows = (partial.rows ?? []).map((row) =>
    row.slice(0, columns.length).concat(Array(Math.max(0, columns.length - row.length)).fill("")),
  );
  return {
    version: partial.version,
    title: partial.title ?? "正在生成页面…",
    description: partial.description ?? "PageSpec 正在流式生成",
    layout: partial.layout,
    breadcrumb: partial.breadcrumb,
    permissionRole: partial.permissionRole,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt,
    filters: partial.filters ?? [],
    stats: partial.stats ?? [],
    columns,
    rows,
    operations: undefined,
    views: partial.views,
    interaction: partial.interaction,
    columnMeta: partial.columnMeta,
    batchActions: partial.batchActions,
    theme: partial.theme,
    styleTokens: partial.styleTokens,
  };
}
