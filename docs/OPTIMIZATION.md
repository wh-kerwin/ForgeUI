# Forge UI 优化方案

**文档版本**：v1.0
**创建日期**：2026-08-24
**关联文档**：[PRD.md](./PRD.md)、[PLAN.md](./PLAN.md)

---

## 1. 概述

本文档针对 `project001 生成式业务UI客户端` 进行代码分析与优化规划。Forge UI 是一个本地优先的生成式业务 UI 桌面客户端，通过自然语言 + OpenAPI 上下文调用 LLM 生成 `PageSpec` DSL，再由前端受控渲染为可交互的业务页面。

当前版本（v0.1.0）已完成 MVP 核心路径，但在代码组织、页面生成能力、交互体验和长期可维护性上仍有较大优化空间。本文档按优先级给出具体可执行方案。

---

## 2. 现状分析

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.6 + Rust |
| 前端 | React 19 + TypeScript + Vite |
| 图标 | lucide-react |
| 数据持久化 | SQLite（rusqlite bundled） |
| 凭证存储 | Windows Credential Manager / macOS Keychain |
| 样式 | 无 CSS 框架，手写 CSS（styles.css、route.css、wide-layout.css、generated.css） |

### 2.2 关键文件规模

| 文件 | 行数 | 备注 |
|------|------|------|
| Workbench.tsx | 91（单行 JSX 超 400 字符） | 路由分发用三元链；全部状态集中于单组件 |
| GeneratedPage.tsx | 256 | 承载筛选、CRUD、编辑弹窗、详情面板全部逻辑 |
| TemplateLibrary.tsx | 114 | 模板搜索、固定、历史、导入导出混杂 |
| useGeneratedPageActions.ts | 62 | API 调用集中，无请求合并 |
| model_provider.rs | 423 | 生成逻辑 + SSE 解析 + schema 校验集中 |
| business_api.rs | 228 | 操作授权校验 + 安全限制 |

### 2.3 核心数据流

```
用户 Prompt ──► model_provider.generate_page() ──► PageSpec JSON
                                            │
                                            ▼
                                    Rust schema 校验
                                            │
                                            ▼
                                   normalize_page_spec()
                                            │
                                            ▼
                              parsePageSpecJson() (前端)
                                            │
                                            ▼
                                   React DSL 渲染
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                        query API      mutate API   delete API
                        (Rust execute) (Rust execute) (Rust execute)
                              │
                              ▼
                        更新本地 rows/columns
```

### 2.4 已识别的主要缺陷

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| D1 | 路由分发用长三元链 | Workbench.tsx:89 | 可读性差，新增路由易出错 |
| D2 | GeneratedPage 承担全部 UI 职责 | GeneratedPage.tsx | 难以单独测试和复用 |
| D3 | 所有表单为裸 JSON textarea | GeneratedPage.tsx:181-226 | 用户体验差，无法利用类型信息 |
| D4 | 无流式渲染 | model_provider.rs:185-258 | 用户等待过程无反馈 |
| D5 | 只能渲染单表列表 | PageSpec type | 不支持看板、图表等视图 |
| D6 | 数据硬截断 100 行 | useGeneratedPageActions.ts:33 | 大数据量丢失 |
| D7 | 无列自定义能力 | DataTable.tsx | 用户无法调整列顺序/显隐 |
| D8 | redirect Policy::none() 过于激进 | business_api.rs:135 | 合法重定向被拒绝 |
| D9 | 无全局状态管理 | Workbench.tsx | props drilling，状态散乱 |
| D10 | 系统提示词硬编码在 Rust | model_provider.rs:189 | 无法按场景定制 |

---

## 3. 优化方案

### 3.1 【高优先级】流式 UI 渲染

**问题**：用户输入 Prompt 后需等待数秒甚至更久才能看到任何输出，体验差。

**目标**：LLM 输出过程中实时展示已生成的 PageSpec 片段，呈现"草稿态 → 完成态"的演进。

#### 3.1.1 前端实现

新增 `features/pages/streamingPageParser.ts`：

```typescript
/**
 * 逐字节/SSE 事件解析 LLM 输出，实时触发 Partial PageSpec 更新。
 * 支持普通 JSON 和 SSE stream 两种模式。
 */
export class StreamingPageParser {
  private buffer = "";
  private braceDepth = 0;
  private jsonStart = -1;
  private partialSpec: Partial<PageSpec> | null = null;
  private onComplete: (spec: PageSpec) => void;
  private onDelta: (partial: Partial<PageSpec>) => void;

  constructor(opts: {
    onDelta: (partial: Partial<PageSpec>) => void;
    onComplete: (spec: PageSpec) => void;
  }) { ... }

  /** 处理一段 SSE data 事件 */
  push(chunk: string): void { ... }

  /** 标记流结束，尝试最终解析 */
  finish(): void { ... }
}
```

#### 3.1.2 后端改造（Rust）

在 `model_provider.rs` 的 `generate_page()` 中增加 SSE 模式：

```rust
// 伪代码：stream 模式返回 Server-Sent Events
pub async fn generate_page_stream(input: GenerateInput) -> impl Response {
    let client = reqwest::Client::builder().build()?;
    // 设置 streaming: true，接收 SSE
    let response = client.post(endpoint(...)).json(&body).send().await?;
    // 包装为 Tauri 事件流返回
    Ok(response)
}
```

Tauri 侧用 `Emitter` 将 SSE 逐条推送至前端：

```rust
#[tauri::command]
async fn generate_page_stream(
    input: GenerateInput,
    emit: Emitter,
) -> Result<(), String> {
    // 逐 token 触发 emit.emit("page-delta", partial_spec)?
}
```

#### 3.1.3 UI 变化

[GeneratedPage.tsx](src/features/pages/GeneratedPage.tsx) 接收 `isStreaming` prop：
- 流式期间显示"生成中…"骨架屏
- 部分解析结果实时更新统计卡片和表格预览
- 完成时刷新完整 PageSpec

---

### 3.2 【高优先级】Schema 驱动的字段渲染器

**问题**：所有新增/编辑表单都是同一个 `<textarea>`，用户需要手写 JSON。

**目标**：根据 OpenAPI schema 自动推断字段类型，渲染对应的原生控件（文本输入、下拉选择、日期、数字等）。

#### 3.2.1 后端新增：OpenAPI Schema 提取

在 [openapi.rs](src-tauri/src/services/openapi.rs) 中增加方法：

```rust
pub fn extract_field_schemas(
    spec: &OpenApiSummary,
    operation_id: &str,
) -> Result<Vec<FieldSchema>, String> { ... }

/// FieldSchema 结构
#[derive(Serialize)]
pub struct FieldSchema {
    pub name: String,
    pub r#type: FieldType,       // "string" | "number" | "integer" | "boolean" | "date" | "enum"
    pub enum_values: Option<Vec<String>>,
    pub required: bool,
    pub description: Option<String>,
}
```

#### 3.2.2 前端字段渲染器

新增 [features/pages/FieldRenderer.tsx](src/features/pages/FieldRenderer.tsx)：

```tsx
type FieldRendererProps = {
  field: FieldSchema;
  value: string;
  onChange: (value: string) => void;
};

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  switch (field.type) {
    case "enum":
      return (
        <select value={value} onChange={e => onChange(e.target.value)}>
          {field.enum_values!.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    case "date":
      return <input type="date" value={value} onChange={e => onChange(e.target.value)} />;
    case "number":
      return <input type="number" value={value} onChange={e => onChange(e.target.value)} />;
    default:
      return <input type="text" value={value} onChange={e => onChange(e.target.value)} />;
  }
}
```

#### 3.2.3 替换 GeneratedPage 中的 textarea

在 [GeneratedPage.tsx:181-226](src/features/pages/GeneratedPage.tsx#L181-L226) 的 Create / Edit 表单区域，根据 `fieldSchemas` 渲染对应控件，而非统一用 textarea。

---

### 3.3 【高优先级】代码结构重构

#### 3.3.1 拆分路由分发（Workbench.tsx）

将 [Workbench.tsx:89](src/features/workbench/Workbench.tsx#L89) 的三元链改为 Map：

```typescript
// 现在：route === "overview" ? <OverviewPage .../> : route === "generate" ? ...
// 改为：
const routeViews: Record<AppRoute, ReactNode> = {
  overview:   <OverviewPage   {...overviewProps} />,
  generate:   generatePage,
  templates:  <TemplateRoute  {...templateProps} />,
  business:   <BusinessPage   {...businessProps} />,
  openapi:    <OpenApiPage    {...openapiProps} />,
  models:     <ModelsPage     {...modelsProps} />,
};
return <div className="app">
  <WorkbenchSidebar route={route} ... />
  {routeViews(route)}
</div>;
```

#### 3.3.2 拆分 GeneratedPage

将 [GeneratedPage.tsx](src/features/pages/GeneratedPage.tsx) 拆分为独立子组件：

```
GeneratedPage.tsx          ← 编排层（容器）
├── PageHeader.tsx         ← 标题 + 描述 + 导出操作
├── FilterBar.tsx          ← 筛选条件输入 + 查询按钮
├── StatsPanel.tsx         ← 统计卡片 + StatChart
├── DataTableView.tsx      ← DataTable + 分页
├── MutationPanel.tsx      ← 新增/编辑/删除表单（含弹窗）
└── RefineBox.tsx          ← 对话修改（已独立，保持不变）
```

每个子组件接收明确的 Props，便于独立测试。

#### 3.3.3 引入 Zustand 全局状态

新增 [store/workbenchStore.ts](src/store/workbenchStore.ts)：

```typescript
import { create } from "zustand";
import type { PageSpec, GenerationSession } from "../types/domain";

type WorkbenchState = {
  page: PageSpec | null;
  detail: Record<string, unknown> | null;
  querying: boolean;
  setPage: (page: PageSpec | null) => void;
  setDetail: (detail: Record<string, unknown> | null) => void;
  setQuerying: (querying: boolean) => void;
  query: (filters: Record<string, string>, operationKey?: string) => Promise<void>;
  loadDetail: (path: string, id: string, operationKey: string) => Promise<void>;
  mutate: (method: string, path: string, body: string, operationKey: string) => Promise<void>;
  deleteRecord: (path: string, id: string, operationKey: string) => Promise<void>;
};

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  page: null,
  detail: null,
  querying: false,
  setPage: (page) => set({ page }),
  // ... 其余 actions 迁移自 useGeneratedPageActions
}));
```

将 `useGeneratedPageActions.ts` 中的逻辑迁移至 store，`GeneratedPage` 改为从 store 读取状态。

---

### 3.4 【中优先级】多视图 PageSpec 扩展

**问题**：当前 PageSpec 仅支持单表列表视图，无法生成 Dashboard 统计图、看板等。

**目标**：扩展 DSL，支持同一数据的多视图渲染。

#### 3.4.1 扩展类型定义

修改 [src/types/domain.ts](src/types/domain.ts) 中的 `PageSpec`：

```typescript
export type PageSpec = {
  version?: number;
  title: string;
  description: string;
  filters: string[];
  stats: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  operations?: OperationBinding[];
  /** 新增：多视图配置 */
  views?: PageView[];
};

export type PageView =
  | { type: "list"; title?: string }  // 现有表格视图
  | {
      type: "chart";
      title: string;
      chartType: "bar" | "line" | "pie";
      xAxisColumn: string;    // 对应 columns 中的列名
      yAxisColumn: string;
      groupByColumn?: string; // 可选，按此列分组
    }
  | {
      type: "kanban";
      title: string;
      groupColumn: string;    // 按此列值分组
      cardFields: string[];   // 卡片上显示的字段
    };
```

同时扩展 Rust schema：

```rust
// domain/page_schema.rs 中的 schema() 函数增加 views 属性
"views": {
  "type": "array",
  "items": {
    "oneOf": [
      { "type": "object", "properties": { "type": {"const": "list"} } },
      { "type": "object", "properties": {
          "type": {"const": "chart"},
          "title": {"type": "string"},
          "chartType": {"enum": ["bar","line","pie"]},
          "xAxisColumn": {"type": "string"},
          "yAxisColumn": {"type": "string"},
          "groupByColumn": {"type": "string"}
        },
        "required": ["type","title","chartType","xAxisColumn","yAxisColumn"]
      },
      // kanban schema...
    ]
  }
}
```

#### 3.4.2 新增视图组件

```
features/pages/
├── ChartPageView.tsx      ← 使用 canvas/SVG 渲染柱状图/折线图/饼图
└── KanbanView.tsx         ← 看板视图，按 groupColumn 分组拖拽
```

不引入重型图表库，保持零额外依赖；用 `<canvas>` 或内联 SVG 自行绘制。

#### 3.4.3 UI 切换

在 [GeneratedPage.tsx](src/features/pages/GeneratedPage.tsx) 顶部增加视图切换 Tab：

```tsx
{page.views && page.views.length > 1 && (
  <div className="view-tabs">
    {page.views.map(view => (
      <button key={view.type} className={activeView === view.type ? "active" : ""}>
        {view.title || view.type}
      </button>
    ))}
  </div>
)}
```

---

### 3.5 【中优先级】列自定义与虚拟滚动

#### 3.5.1 列配置面板

在 [DataTable.tsx](src/features/pages/DataTable.tsx) 中增加列配置：

```tsx
// 新增列配置状态
const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
const [columnOrder, setColumnOrder] = useState<string[]>(columns);

// 列拖拽排序（使用原生 HTML5 drag）
// 列显隐切换按钮
```

#### 3.5.2 虚拟滚动

当数据量 > 200 行时启用虚拟滚动，替代全量渲染：

```bash
npm install @tanstack/react-virtual
```

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

const rowVirtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 36,
});
```

#### 3.5.3 数据加载优化

在 [useGeneratedPageActions.ts](src/features/pages/useGeneratedPageActions.ts) 中对快速连续查询做防抖：

```typescript
import { debounce } from "lodash/debounce"; // 或手写简版防抖

const debouncedQuery = debounce((filters, operationKey) => {
  query(filters, operationKey);
}, 300);
```

---

### 3.6 【中优先级】Prompt 模板引擎

**问题**：系统提示词硬编码在 [model_provider.rs:189](src-tauri/src/services/model_provider.rs#L189)，无法按业务场景定制。

**目标**：允许用户按场景选择不同系统提示词模板。

#### 3.6.1 新增 PromptTemplate 类型

```typescript
// src/types/domain.ts
export type PromptTemplate = {
  id: string;
  name: string;
  scene: "dashboard" | "crud" | "report" | "kanban";
  systemPrompt: string;
  isDefault?: boolean;
};
```

#### 3.6.2 预设模板

在 `model_provider.rs` 或前端新增内置模板，按场景拼接不同的系统提示词：

| 场景 | 特点 |
|------|------|
| Dashboard | 强调 stats、chart、趋势分析 |
| CRUD | 强调表格、筛选、新增/编辑/删除操作 |
| Report | 强调分页、导出、汇总统计 |
| Kanban | 强调看板分组、卡片展示 |

#### 3.6.3 用户自定义

在 Models 路由页增加"系统提示词模板"管理，支持新增/编辑/删除自定义模板，并绑定到特定模型配置。

---

### 3.7 【低优先级】样式与交互优化

#### 3.7.1 样式统一

当前有 4 个 CSS 文件散落各处：
- `styles.css` — 基础样式
- `route.css` — 路由页面样式
- `wide-layout.css` — 宽屏适配
- `generated.css` — 生成页面样式

建议合并为语义化目录结构：

```
src/styles/
├── _variables.css     /* CSS 变量：颜色、间距、字体 */
├── _reset.css         /* 基础 reset */
├── layout.css         /* 侧栏、主内容区布局 */
├── components/
│   ├── button.css
│   ├── table.css
│   ├── card.css
│   └── modal.css
└── pages/
    ├── overview.css
    ├── generated.css
    └── templates.css
```

#### 3.7.2 响应式优化

当前 [styles.css:1](src/styles.css#L1) 的移动端适配仅处理了侧栏折叠，主内容区在小屏下仍有溢出风险。增加 `max-width` 约束和横向滚动边界。

#### 3.7.3 加载状态细化

当前只有 `querying: boolean` 一个状态，无法区分"正在查询"、"正在生成"、"正在保存"等不同阶段。增加独立的状态枚举：

```typescript
type LoadingState = "idle" | "generating" | "querying" | "mutating" | "saving";
```

---

## 4. 后续迭代功能规划

### Phase 1：体验提升（预计 1-2 周）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 流式预览 | LLM 输出过程中实时显示生成的 PageSpec 片段 | P0 |
| 字段类型渲染 | 根据 OpenAPI schema 渲染对应控件（非 textarea） | P0 |
| 列配置面板 | 拖拽排序、隐藏/显示列、调整列宽 | P1 |
| 模板分类 | 在模板库按 Dashboard/CRUD/报表/看板分类展示 | P1 |

### Phase 2：数据深度（预计 2-4 周）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 多视图支持 | Table / Chart / Kanban 三种视图切换 | P0 |
| 关联数据展开 | 点击行内外键展开子表数据（如订单→订单项） | P1 |
| 批量操作 | 勾选多行批量删除/状态修改 | P1 |
| 智能数据导出 | 按当前筛选条件导出 CSV/XLSX，而非全量 | P2 |

### Phase 3：协作与智能化（预计 1-2 月）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 版本 Diff | 模板版本间展示 PageSpec 变更 diff | P1 |
| AI 辅助修复 | API 返回数据结构与 PageSpec 列不匹配时，自动建议修复 | P1 |
| 多后端切换 | 同一页面可绑定多个业务 API，运行时切换数据源 | P2 |
| 插件系统 | 开放 `PageView` 渲染器为插件接口，社区可扩展新视图 | P2 |
| 快捷键支持 | 全局快捷键（⌘K 快速生成、⌘S 保存模板等） | P2 |

---

## 5. 实施路线图

```
Week 1-2    重构阶段
            ├── 拆分 GeneratedPage 为子组件
            ├── Workbench 路由分发重构
            ├── Zustand store 搭建
            └── 列配置面板（拖拽 + 显隐）

Week 3-4    生成能力增强
            ├── 流式渲染（前端 Parser + Rust SSE）
            ├── Schema 驱动字段渲染器
            └── 防抖查询 + 加载状态细化

Week 5-6    多视图扩展
            ├── PageSpec DSL 扩展（views 字段）
            ├── ChartPageView（纯 Canvas/SVG）
            └── KanbanView

Week 7+     迭代功能
            ├── Prompt 模板引擎
            ├── 版本 Diff
            └── 插件系统预研
```

---

## 6. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| 流式解析稳定性 | LLM 中途输出可能被截断，JSON 不完整 | 使用增量 JSON 解析库（如 `nearley`），每收到一个 token 尝试补全 |
| PageSpec 版本升级 | 现有模板不兼容新 `views` 字段 | 前端 `parsePageSpec` 增加向后兼容逻辑，缺少 views 时默认使用 list 视图 |
| 零额外依赖约束 | 官方设计不引入第三方库 | 优先使用原生 API（HTML5 drag、Canvas）；必须引入时评估 bundle 体积 |
| Rust SSE 实现复杂度 | Tauri 2 对 SSE 流的支持需要额外封装 | 可先用非流式 MVP 验证流程，再逐步迁移 |

---

## 7. 附录

### A. 关键文件索引

| 文件 | 作用 |
|------|------|
| [src/types/domain.ts](src/types/domain.ts) | 类型定义（PageSpec、ModelConfig 等） |
| [src/features/pages/GeneratedPage.tsx](src/features/pages/GeneratedPage.tsx) | 生成页面主渲染器 |
| [src/features/pages/parsePageSpec.ts](src/features/pages/parsePageSpec.ts) | 前端 JSON 解析与修复 |
| [src/features/pages/modelSafePageSpec.ts](src/features/pages/modelSafePageSpec.ts) | 发送给模型的 PageSpec 脱敏版本 |
| [src/features/pages/useGeneratedPageActions.ts](src/features/pages/useGeneratedPageActions.ts) | 页面 API 调用逻辑 |
| [src/features/workbench/Workbench.tsx](src/features/workbench/Workbench.tsx) | 应用根组件 |
| [src-tauri/src/services/model_provider.rs](src-tauri/src/services/model_provider.rs) | LLM 调用 + PageSpec 生成 |
| [src-tauri/src/services/business_api.rs](src-tauri/src/services/business_api.rs) | 业务 API 执行 + 安全校验 |
| [src-tauri/src/domain/page_schema.rs](src-tauri/src/domain/page_schema.rs) | PageSpec JSON Schema 定义 + 归一化 |
| [src-tauri/src/domain/page_spec.rs](src-tauri/src/domain/page_spec.rs) | PageSpec 结构体 + 校验逻辑 |

### B. 变更影响范围预估

| 优化项 | 涉及文件数 | 预估改动量 |
|--------|-----------|-----------|
| 流式渲染 | 4（新增 2） | 中 |
| Schema 字段渲染 | 3（新增 1） | 中 |
| 代码结构重构 | 5 | 小（纯重构，无功能变化） |
| 多视图扩展 | 5（新增 3） | 大 |
| 列自定义 | 2（新增 1） | 小 |
| Prompt 模板 | 2（新增 1） | 小 |

---

## 8. 实施状态审计（2026-08-25）

本轮以第 3 节的可运行优化项为验收范围。第 4 节是后续产品路线图，其中的关联数据、批量操作、版本 Diff、多数据源与插件系统仍需要单独的交互和数据契约设计，不计入本轮实现缺口。

| 优化项 | 状态 | 已落地内容 |
|--------|------|------------|
| 3.1 流式 UI 渲染 | 已完成 | Rust 流式请求与 SSE 增量解码、Tauri requestId 隔离事件、前端增量 Parser、草稿预览、完成前禁用业务操作 |
| 3.2 Schema 字段渲染 | 已完成 | OpenAPI 参数与 requestBody 字段提取、文本/数字/整数/布尔/日期/枚举控件、新增与行编辑表单校验及序列化 |
| 3.3 代码结构重构 | 已完成 | 路由 Map；PageHeader、FilterBar、StatsPanel、DataTableView、MutationPanel 等组件拆分；查询/详情/变更/删除 actions 迁入 Zustand store |
| 3.4 多视图 PageSpec | 已完成 | TypeScript/Rust DSL、Schema 与向后兼容解析；List/Bar/Line/Pie/Kanban；同类型多 Tab；图表分组与看板本地拖放 |
| 3.5 列配置与虚拟滚动 | 已完成 | 列排序、显隐、列宽调节；200 行以上原生虚拟滚动；API 完整结果保留；300ms 防抖与过期请求结果隔离 |
| 3.6 Prompt 模板引擎 | 已完成 | 四种内置场景、自定义模板新增/编辑/删除、本地持久化、模型默认模板绑定、生成与修改请求注入 |
| 3.7 样式与交互 | 已完成 | 统一 LoadingState、生成/查询/变更状态、流式状态、统一自定义下拉控件、小屏表格边界及视图/表单/导航响应式布局 |

### 8.1 实现差异说明

- 虚拟滚动采用原生窗口化实现，没有引入 `@tanstack/react-virtual`，避免为单一表格增加运行时依赖。
- CSS 保持现有入口文件，完成了变量复用、组件样式和响应式规则；未做纯物理目录迁移，避免在无行为收益的情况下扩大文件移动范围。
- 所有原生下拉已统一为紧凑型 `SelectField`；触发器和选项在桌面与窄窗口均统一为 26px。菜单在打开前先计算可视区内的初始位置，挂载后再按真实高度校正展开方向、水平边界和最大高度；窄窗口不会被父容器裁切，也不会停留在隐藏态。
- 看板拖放先更新当前页面的本地数据。只有 OpenAPI 明确提供并绑定状态更新接口时，才应扩展为服务端持久化。

### 8.2 验证结果

| 检查 | 结果 |
|------|------|
| `npm run build` | 通过 |
| `npm test` | 40 passed，0 failed；包含 4 项窄视口下拉定位边界测试 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo test` | 51 passed，0 failed |
| 真实模型一致性验收 | 未达 95%：正式 50 次验收运行到 8 次时已出现 3 个 `invalid-output`（5/8 schema-pass），理论最高合规率降至 94%，因此提前停止以避免无效调用；随后 Dashboard / CRUD / enterprise-theme 各 1 条最小诊断均通过，说明链路可用但供应商输出稳定性仍不足 |
| 响应式下拉 | 触发器与选项统一为 26px；Portal 菜单在 320 / 520 / 1280px 均位于可视区内，320px 下可自动向上展开且无水平溢出 |
| `git diff --check` | 通过（仅 Git 的 LF/CRLF 提示） |
| `npm run validate:updater` | 未通过：缺少真实发布文件 `src-tauri/tauri.updater.release.json`；仓库只有模板，不能生成真实签名配置 |

### 8.3 后续独立迭代

第 4 节 Phase 1–3 中未被第 3 节覆盖的功能继续保留为路线图：模板分类、关联数据展开、批量操作、筛选条件导出、版本 Diff、AI 辅助修复、多后端切换、插件系统和全局快捷键。这些功能会改变持久化结构、API 契约或主要交互，实施前应分别补充验收标准。
