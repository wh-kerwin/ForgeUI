# 页面生成优化方案 v2（B 端 + C 端场景）

**文档版本**：v2.0
**创建日期**：2026-08-25
**关联文档**：[OPTIMIZATION.md](../OPTIMIZATION.md)、[PLAN.md](../PLAN.md)
**适用范围**：project001 生成式业务UI客户端 — 基于现有 PageSpec DSL 与现有弹窗实现进行二次扩展

---

## 1. 概述

上一版 [OPTIMIZATION.md](../OPTIMIZATION.md) 以 B 端需求为核心，覆盖了提示词、模型响应解析、DSL 结构、多视图等方向。本文档在此基础上补充 **C 端用户场景** 的优化策略，重点解决：

- 增删改查操作在页面上的交互方式（弹窗 / 抽屉 / 内联表单）
- C 端用户更偏好的"轻量级操作"体验
- B 端管理后台与 C 端消费者界面的统一 DSL 表达
- 生成页面从"功能可用"到"体验良好"的差距

优化方向覆盖提示词、模型返回结构、页面渲染层、组件层四个层次，优先实施 ROI 最高的项。

---

## 2. B 端场景优化补充

### 2.1 提示词层

#### 2.1.1 问题现状

[Built-in Prompt Templates](../../src/features/workbench/promptTemplates.ts) 当前的系统提示词仅一行，缺少：

- 明确的输出格式约束（JSON Schema、字段枚举值）
- Few-shot 示例（不同场景各 1-2 个参考 JSON 输出）
- B2b 专属规则（权限角色绑定、分页元数据、列格式化）
- 模板上下文与场景提示的拼接顺序不规范

#### 2.1.2 优化方案：分层 Prompt Composer

引入 `PromptComposer`，将系统提示词拆为可组合层：

```
PromptComposer 输出 = {
  persona: "B端产品设计助手",
  constraints: [...],         // 输出格式约束，固定不变
  scene_specific: [scenePrompt], // 当前 prompt 场景（dashboard/crud/report/kanban）
  template_context: [...],    // 已有 PageSpec 结构上下文
  openapi_context: [...],     // API 结构摘要（来自 buildOpenApiContext）
}
```

**示例：CRUD 场景增强系统提示词**

```typescript
const CRUD_SYSTEM_PROMPT = `
你是专业的 B 端产品 UI 设计助手。根据用户需求和 OpenAPI 结构生成 PageSpec JSON。

【必须遵守】
1. 只输出合法 JSON，禁止 markdown 代码块包裹
2. title/description 使用与用户输入相同的语言（中文/英文）
3. filters 中的每一项必须是真实存在的有效筛选字段
4. columns 与 rows 长度严格对齐，每行 cell 数 = columns 长度
5. operations 仅引用已授权的 operation_id，不得编造路径或 HTTP 方法
6. 需要统计图表时，stats 字段标注数据来源 operation_id
7. 新增/create 操作必须绑定 POST 接口并标注 role: "create"

【输出格式】
直接输出 JSON，不要任何解释：
{
  "version": 1,
  "title": "...",
  "description": "...",
  "filters": ["status", "created_at"],
  "stats": [{"label": "今日新增", "value": "get_orders_today"}],
  "columns": ["订单号", "状态", "创建时间", "金额"],
  "rows": [["ORD-001", "已完成", "2026-08-24", "¥1,234"]],
  "operations": [
    {"operation_id": "list_orders", "method": "GET", "path": "/api/v1/orders", "role": "list"},
    {"operation_id": "create_order", "method": "POST", "path": "/api/v1/orders", "role": "create"},
    {"operation_id": "update_order", "method": "PUT", "path": "/api/v1/orders/{id}", "role": "update"},
    {"operation_id": "delete_order", "method": "DELETE", "path": "/api/v1/orders/{id}", "role": "delete"}
  ],
  "views": []
}
`;
```

**Few-shot 注入机制**

每个 scene 附带 1-2 个参考 JSON 片段，插入到 system prompt 末尾：

```typescript
const FEW_SHOT_DASHBOARD = `{
  "title": "订单统计 Dashboard",
  "description": "展示近 30 天订单趋势与关键指标",
  "filters": ["date_range", "status"],
  "stats": [
    {"label": "今日订单", "value": "get_order_today_count"},
    {"label": "本月 GMV", "value": "get_gmv_month"}
  ],
  "columns": ["日期", "订单数", "金额"],
  "rows": [["2026-08-24", "1,234", "¥56,789"]],
  "operations": [{
    "operation_id": "get_orders_summary",
    "method": "GET",
    "path": "/api/v1/orders/summary",
    "role": "stats"
  }],
  "views": [{
    "type": "chart",
    "title": "趋势图",
    "chartType": "line",
    "xAxisColumn": "日期",
    "yAxisColumn": "订单数"
  }]
}`;
```

#### 2.1.3 实现位置

- 前端：新建 [features/workbench/PromptComposer.ts](../../src/features/workbench/PromptComposer.ts)
- 修改：[features/workbench/modelRequest.ts](../../src/features/workbench/modelRequest.ts) 的 `buildModelRequest()` 接入 composer 输出

---

### 2.2 模型响应解析层

#### 2.2.1 问题现状

[streamingPageParser.ts](../../src/features/pages/streamingPageParser.ts) 的 `repairJson` 只做括号匹配，无法处理：
- JSONC 风格的注释（`//` 和 `/* */`）
- 字符串未闭合（模型中途输出被截断）
- 尾逗号（`"value": "x",`）
- 多字段同时缺失

#### 2.2.2 优化方案：多层 JSON 修复策略

```typescript
private repairJson(source: string): string {
  // 步骤 1: 去除 markdown 代码块包裹
  // 步骤 2: 去除 JSONC 风格注释（// 和 /* */）
  // 步骤 3: 去除尾逗号（正则替换）
  // 步骤 4: 逐字符扫描，补全未闭合字符串
  // 步骤 5: 补全未闭合对象/数组
  // 步骤 6: 尝试 JSON.parse，失败则走字段提取 fallback
  return output;
}
```

**结构化字段提取 Fallback**（当 JSON 完全无法修复时）：

```typescript
private extractStructuredFields(source: string): Partial<PageSpec> | null {
  const titleMatch = source.match(/"title"\s*:\s*"([^"]+)"/);
  const descMatch = source.match(/"description"\s*:\s*"([^"]+)"/);
  // 只提取能安全解析的部分，避免假数据误导用户
  return {
    title: titleMatch?.[1] ?? "生成失败",
    description: descMatch?.[1] ?? "",
  };
}
```

#### 2.2.3 views 流式解析支持

当前 `toPartialPageSpec` 缺少 `views` 字段，导致流式预览丢失视图配置：

```typescript
private toPartialPageSpec(value: unknown): Partial<PageSpec> | null {
  // ... 现有字段
  if (Array.isArray(record.views)) {
    partial.views = record.views.filter((view): view is PageView =>
      typeof view === "object" &&
      view !== null &&
      typeof (view as Record<string, unknown>).type === "string"
    );
  }
  return Object.keys(partial).length > 0 ? partial : null;
}
```

---

### 2.3 PageSpec 数据结构增强

#### 2.3.1 列级别元数据

当前 `columns` 仅为 `string[]`，缺乏格式化规则，B 端表格常见需求无法满足：

```typescript
// 新增类型
export type ColumnMeta = {
  name: string;
  type: "string" | "number" | "date" | "datetime" | "enum" | "boolean" | "money";
  format?: string;                // "YYYY-MM-DD" | "¥#,##0.00"
  enumLabels?: Record<string, string>;  // 枚举值 → 显示名映射
  sortable?: boolean;
  filterable?: boolean;
  searchMode?: "exact" | "fuzzy" | "range";
  width?: string;                 // "120px" | "auto" | "15%"
  visible?: boolean;              // 默认是否显示（用于隐藏敏感列）
};
```

#### 2.3.2 操作角色细化

当前 `operations` 绑定信息过于简单，B 端权限控制和分页参数无法表达：

```typescript
export type OperationBinding = {
  operation_id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  role: "list" | "detail" | "create" | "update" | "delete" | "stat" | "export";
  bodySchema?: FieldSchema[];         // 新增/编辑时的表单结构
  pagination?: {
    pageParam: string;
    sizeParam: string;
    defaultSize: number;
  };
  sortParam?: string;
  confirmMessage?: string;            // 删除确认文案
};
```

**运行时约定**：当列表操作声明 `sortParam` 时，可排序表头除本地即时排序外，还会以 `column,asc` / `column,desc` 作为该查询参数的值重新请求列表接口；未声明 `sortParam` 时仅执行本地排序，保持旧 PageSpec 行为。

#### 2.3.3 页面级元数据

```typescript
export type PageSpec = {
  // ... 现有字段保持不变
  layout?: "sidebar" | "full" | "modal";   // 页面布局
  breadcrumb?: string[];                   // 面包屑路径
  permissionRole?: string;                 // 所需角色（前端权限控制）
  createdAt?: string;
  updatedAt?: string;
};
```

`permissionRole` 由业务连接中的“当前用户角色”配置提供前端可见性判断。该判断只用于避免误展示和误操作，不替代业务服务端鉴权；所有 operation 仍必须通过 Rust 侧授权校验。

---

### 2.4 页面结构生成优化

#### 2.4.1 多 View 组合渲染

当前 `views` 类型已定义但未充分利用，增加组合类型：

```typescript
export type PageView =
  | { type: "list"; title?: string; defaultSort?: { column: string; order: "asc" | "desc" } }
  | { type: "chart"; title: string; chartType: "bar" | "line" | "pie"; xAxisColumn: string; yAxisColumn: string; groupByColumn?: string }
  | { type: "kanban"; title: string; groupColumn: string; cardFields: string[] }
  | { type: "tabs"; items: { key: string; label: string; view: PageView }[] }   // 新增 Tab 组合
  | { type: "split"; left: PageView; right: PageView; splitRatio?: number };    // 新增左右分栏
```

#### 2.4.2 智能操作角色推断

在 `buildOpenApiContext` 时自动推断各 operation 的角色，减少模型幻觉：

```typescript
function inferOperationRoles(operations: AllowedOperation[]): Record<string, string[]> {
  const roles: Record<string, string[]> = {};
  for (const op of operations) {
    const parts = op.path.split("/");
    const hasIdParam = parts.some(p => p.startsWith(":") || p === "{id}" || /^\{\w+\}$/.test(p));
    if (op.method === "GET" && hasIdParam) roles[op.operation_id].push("detail");
    else if (op.method === "GET") roles[op.operation_id].push("list", "stat");
    else if (op.method === "POST" && /\/(create|add|batch)/i.test(op.path)) roles[op.operation_id].push("create");
    else if (["PUT", "PATCH"].includes(op.method) && hasIdParam) roles[op.operation_id].push("update");
    else if (op.method === "DELETE" && hasIdParam) roles[op.operation_id].push("delete");
  }
  return roles;
}
```

在 system prompt 中附加推断结果，让模型明确知道哪个接口对应哪个角色。

#### 2.4.3 批量操作支持

```typescript
export type BatchAction = {
  operation_id: string;
  method: "POST" | "DELETE";
  path: string;
  confirmMessage: string;
  payloadBuilder: { type: "ids" | "custom"; customPayload?: string };
};
```

在 `PageSpec` 顶层增加 `batchActions?: BatchAction[]`，由渲染器生成批量操作工具栏。

---

## 3. C 端场景优化（弹窗交互）

### 3.1 背景与目标

C 端（消费者端）用户与普通 B 端管理后台用户的行为模式不同：

| 对比维度 | B 端用户 | C 端用户 |
|---------|---------|---------|
| 操作频率 | 高频、重复 | 低频、偶发 |
| 操作时长 | 长时间停留在页面 | 快速完成即离开 |
| 表单复杂度 | 字段多、结构复杂 | 字段少、轻量 |
| 导航偏好 | 页面内操作 | 弹窗/抽屉不跳转 |
| 容错要求 | 可接受稍慢 | 要求即时反馈 |
| 数据敏感度 | 高（企业数据） | 中（个人数据） |

**核心目标**：让同一份 `PageSpec` 能同时适配 B 端管理后台和 C 端消费者界面，通过 DSL 中的 `layout`、`interaction` 等字段控制渲染行为，而不是生成两套页面。

### 3.2 现有弹窗实现分析

当前 [MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx) 已有基础弹窗能力：

| 功能 | 实现状态 | 问题 |
|------|---------|------|
| 编辑行内弹窗 | ✅ 已有（editingRow 触发） | 仅支持单行，无字段校验联动 |
| 删除确认弹窗 | ✅ 已有（deletingRow 触发） | 仅展示行 ID，无前后对比 |
| 新增表单弹窗 | ❌ 未实现（MutationPanel 中的 create 是内联 box） | C 端用户不习惯在列表下方找表单 |
| 详情弹窗 | ⚠️ 部分实现（detailOperation 需手动输入 ID） | 无快捷入口，不支持从列表行一键打开 |
| 关闭遮罩层点击 | ✅ 已有 | 无 ESC 键关闭支持 |

### 3.3 C 端弹窗交互规范

#### 3.3.1 新增操作：从内联表单改为弹窗

**改造前现状**：[MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx) 的新增表单位于页面底部内联 box，C 端用户不容易注意到。

**优化方案**：增加"新增"按钮触发全屏弹窗（Modal），弹窗内容包含：
- 标题（页面名 + "新增"）
- 表单字段（基于 `fieldSchemas` 渲染，与编辑弹窗一致）
- 提交 / 取消按钮
- ESC 键关闭、遮罩层点击关闭

```tsx
// 在 GeneratedPage.tsx 的页面头部增加"新增"按钮
{createOperation && (
  <button className="primary add-btn" onClick={() => setCreating(true)}>
    <Plus size={14} />
    {zh ? "新增" : "New"}
  </button>
)}

// 新增弹窗
{creating && createOperation && (
  <Modal onClose={() => setCreating(false)} title={zh ? "新增记录" : "Create Record"}>
    <Form fields={createFields} values={formValues} onChange={setFormValues} onError={setFormError} />
    <ModalActions>
      <button className="secondary" onClick={() => setCreating(false)}>{zh ? "取消" : "Cancel"}</button>
      <button className="primary" onClick={submitCreate}>{zh ? "提交" : "Submit"}</button>
    </ModalActions>
  </Modal>
)}
```

#### 3.3.2 编辑操作：保持弹窗，增加字段联动

**改造前现状**：[MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx) 已有编辑弹窗，但：
- 无字段类型联动（如修改"状态"后其他字段自动隐藏/显示）
- 无必填字段实时校验
- 无操作前后的数据对比预览

**优化方案**：
1. 实时字段校验（失焦时校验，错误时即时提示）
2. 增删字段联动（根据枚举值动态显示/隐藏关联字段）
3. 操作前数据对比（显示变更项高亮）

```tsx
// 字段级校验状态
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

// 实时校验
function onFieldChange(fieldName: string, value: string) {
  setEditValues(prev => ({ ...prev, [fieldName]: value }));
  // 失焦时校验
}

function validateField(field: FieldSchema, value: string): string | null {
  if (field.required && !value) return `${field.name} 为必填项`;
  if (field.type === "number" && value && isNaN(Number(value))) return `${field.name} 必须是数字`;
  if (field.type === "enum" && field.enumValues && !field.enumValues.includes(value)) return `请选择有效的 ${field.name}`;
  return null;
}
```

#### 3.3.3 删除操作：增强确认弹窗

**改造前现状**：[MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx) 的删除确认弹窗只显示行 ID。

**优化方案**：
- 显示删除对象的完整信息（从 rowRecord 获取）
- 显示关联数据风险（如果有外键关联）
- 二次确认文案定制（来自 `OperationBinding.confirmMessage`）

```tsx
{deletingRow && deleteOperation && (
  <Modal onClose={onCloseDelete} variant="danger">
    <ModalHeader>
      <span className="eyebrow">DELETE · CONFIRMATION</span>
      <h4>{zh ? "确认删除" : "Confirm Deletion"}</h4>
    </ModalHeader>
    <ModalBody>
      <p className="modal-intro">
        {deleteOp?.confirmMessage ??
         (zh
           ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。`
           : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}
      </p>
      {/* 显示删除对象的摘要信息 */}
      <dl className="delete-preview">
        {page.columns.slice(0, 4).map(col => (
          <Fragment key={col}>
            <dt>{col}</dt>
            <dd>{rowRecord(deletingRow)[col]}</dd>
          </Fragment>
        ))}
      </dl>
    </ModalBody>
    <ModalActions>
      <button className="secondary" onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</button>
      <button className="danger" onClick={() => onDelete(...)}>
        {zh ? "确认删除" : "Delete"}
      </button>
    </ModalActions>
  </Modal>
)}
```

#### 3.3.4 详情操作：快捷入口 + 弹窗

**改造前现状**：详情操作需手动输入 ID（[MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx)），C 端用户极不方便。

**优化方案**：
- 表格行操作列增加"查看"按钮，点击直接打开详情弹窗
- 弹窗支持从 row 数据预填充（如果模型已生成 rows）

```tsx
// DataTable 增加 onView 回调（已有，但需确保每行都显示查看按钮）
<DataTableView
  columns={page.columns}
  rows={localRows}
  onView={(row) => {
    if (detailOperation) {
      onDetail(operationPath(detailOperation, "GET"), rowId(row), detailOperation);
    } else {
      setLocalDetail(rowRecord(row)); // fallback: 显示本地数据
    }
  }}
  onEdit={setEditingRow}
  onDelete={deleteOperation ? setDeletingRow : undefined}
/>
```

### 3.4 C 端弹窗通用组件

为复用各场景弹窗，抽取通用 Modal 组件：

```tsx
// features/pages/Modal.tsx
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  variant?: "default" | "danger" | "success";
  size?: "sm" | "md" | "lg" | "fullscreen";
  children: ReactNode;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
};

export function Modal({
  open, onClose, title, subtitle, variant = "default", size = "md",
  children, closeOnBackdropClick = true, closeOnEscape = true,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    fullscreen: "max-w-none w-full h-full",
  };

  return (
    <div className="modal-backdrop" onClick={closeOnBackdropClick ? onClose : undefined}>
      <div className={`modal ${sizeClasses[size]} ${variant !== "default" ? `modal--${variant}` : ""}`} onClick={e => e.stopPropagation()}>
        {(title || subtitle) && (
          <div className="modal-header">
            <div>
              {title && <h2>{title}</h2>}
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
            <button className="icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
```

**CSS 样式补充**（添加到 [wide-layout.css](../../src/wide-layout.css)）：

```css
/* 弹窗尺寸 */
.modal--sm { max-width: 400px; }
.modal--md { max-width: 560px; }
.modal--lg { max-width: 720px; }

/* 危险弹窗（删除确认） */
.modal--danger .modal-header h2 { color: #ff9aa0; }
.modal--danger .modal-actions .danger { background: #ff7f86; color: #fff; }

/* 成功弹窗（提交成功反馈） */
.modal--success .modal-header h2 { color: #9ddc5b; }

/* 弹窗 body 滚动 */
.modal-body { max-height: calc(90vh - 140px); overflow-y: auto; }

/* 表单字段布局 */
.modal-form-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.modal-form-field label { font-size: 12px; color: #9da8ba; }
.modal-form-field input,
.modal-form-field select,
.modal-form-field textarea {
  border: 1px solid #303b4b;
  border-radius: 6px;
  padding: 10px;
  background: #0e131a;
  color: #e8edf6;
  font-size: 14px;
}
.modal-form-field input:focus,
.modal-form-field select:focus { border-color: #9bbd54; outline: none; }
.modal-form-field .field-error { font-size: 11px; color: #ff9aa0; }

/* 删除预览 */
.delete-preview { margin: 16px 0; padding: 12px; background: #1a1f28; border-radius: 8px; }
.delete-preview dt { font-size: 11px; color: #768195; margin-top: 8px; }
.delete-preview dd { font-size: 14px; color: #e8edf6; }
```

### 3.5 C 端弹窗时机控制

不同场景下弹窗的触发方式应不同，通过 `PageSpec.interaction` 字段控制：

```typescript
export type InteractionMode =
  | "modal"      // 弹窗（C 端推荐）
  | "drawer"     // 右侧抽屉（适合长表单）
  | "inline"     // 页面内展开（B 端推荐）
  | "redirect";  // 跳转新页面（传统 B 端）

export type PageSpec = {
  // ... 现有字段
  interaction?: {
    create?: InteractionMode;
    update?: InteractionMode;
    delete?: InteractionMode;
    detail?: InteractionMode;
  };
};
```

**默认值**（向后兼容）：
- B 端场景：`create: "inline"`, `update: "inline"`, `delete: "modal"`, `detail: "inline"`
- C 端场景：`create: "modal"`, `update: "modal"`, `delete: "modal"`, `detail: "modal"`

系统提示词中增加规则：
> 当用户描述 C 端/消费者应用场景时，将 interaction 各字段设为 "modal"；当描述 B 端管理后台时，保持默认 inline 模式。

`redirect` 使用客户端受控子路由 `/generate/{action}/{id?}` 展示独立操作页，并通过浏览器历史返回列表。operation 中的 API `path` 绝不作为前端导航地址。

---

## 5. Theme Token 主题系统

### 5.1 现状问题

当前渲染管线为单向硬编码：

```
PageSpec DSL ──► 固定 className ──► 硬编码 CSS 变量 ──► 唯一视觉
```

**模型无法控制任何视觉属性**。即使用户在 prompt 中说"用 Ant Design 风格"或"浅色主题"，模型只能生成数据，渲染逻辑是前端写死的。具体表现：

| 层 | 现状 | 问题 |
|---|---|---|
| **CSS 变量** | `route.css:15` 固定了颜色、圆角、间距 | 没有主题变量切换机制 |
| **组件样式** | `generated.css` 所有组件用固定 className 写死样式 | 无法按框架/主题替换 |
| **PageSpec DSL** | 只有数据字段，无 `theme` / `styleOverrides` | 模型输出无法携带视觉指令 |
| **Prompt** | 系统提示词没有视觉约束部分 | 模型不知道要遵循哪个风格 |

### 5.2 设计目标

- 用户可在 prompt 中指定主题风格（"用企业蓝风格"、"浅色干净主题"等）
- 同一 PageSpec 数据可对应多种视觉呈现
- 不改现有组件结构，只通过 CSS 变量注入不同风格
- 兼容旧版 PageSpec（不含 theme 字段时回退到默认暗色）

### 5.3 PageSpec 扩展：新增 theme 字段

#### 5.3.1 类型定义

在 [types/domain.ts](../../src/types/domain.ts) 中增加：

```typescript
/** 内置主题风格 */
export type ThemeStyle =
  | "forge-default"   // 现有暗色风格（默认）
  | "enterprise-blue" // 企业蓝白，类 Ant Design Pro
  | "clean-light"     // 干净浅色，类 Element Plus
  | "minimal-dark"    // 极简深色，类 shadcn/ui
  | "custom";         // 用户自定义 token（通过 styleTokens 传入）

/** 主题 Token，可覆盖默认主题的任何视觉属性 */
export type StyleToken = {
  // 颜色
  primary?: string;       // --fg-primary（强调色，用于 pill、高亮文字）
  primaryBg?: string;     // --fg-primary-bg（主按钮背景）
  primaryBgHover?: string;// --fg-primary-bg-hover（主按钮悬停）
  surface?: string;       // --fg-surface（页面背景）
  surfaceAlt?: string;    // --fg-surface-alt（卡片/区块背景）
  surfaceControl?: string;// --fg-surface-control（控件背景）
  border?: string;        // --fg-border（边框色）
  borderControl?: string; // --fg-border-control（控件边框）
  focusRing?: string;     // --fg-focus-ring（聚焦环/选中态）
  text?: string;          // --fg-text（主文字）
  textMuted?: string;     // --fg-text-muted（次要文字）
  textSubtle?: string;    // --fg-text-subtle（提示文字）
  danger?: string;        // --fg-danger（危险操作色）
  dangerBg?: string;      // --fg-danger-bg（危险按钮背景）
  success?: string;       // --fg-success（成功/通过色）
  // 形状
  radius?: "none" | "sm" | "md" | "lg" | "full";
  // 密度
  density?: "compact" | "comfortable" | "relaxed";
};
```

`PageSpec` 增加两个可选字段：

```typescript
export type PageSpec = {
  // ... 现有字段保持不变
  theme?: ThemeStyle;         // 主题风格，默认为 "forge-default"
  styleTokens?: StyleToken;   // 覆盖默认 token（仅 theme="custom" 时有意义）
};
```

#### 5.3.2 内置主题预设

新建 [features/pages/themePresets.ts](../../src/features/pages/themePresets.ts)：

```typescript
import type { StyleToken, ThemeStyle } from "../../types/domain";

/** 各内置主题的完整 Token 定义，颜色值与实际 CSS 中的硬编码值对齐 */
export const THEME_PRESETS: Record<ThemeStyle, StyleToken> = {
  // 现有 Forge 暗色风格，保持完全一致
  "forge-default": {
    primary: "#d5fa61",
    primaryBg: "#d5fa61",
    primaryBgHover: "#e1ff83",
    surface: "#0b0e13",
    surfaceAlt: "#10151d",
    surfaceControl: "#101720",
    border: "#242a35",
    borderControl: "#2d3949",
    focusRing: "#d5fa61",
    text: "#e9edf5",
    textMuted: "#768195",
    textSubtle: "#687187",
    danger: "#ff9aa0",
    dangerBg: "#25171d",
    success: "#9ddc5b",
    radius: "md",
    density: "comfortable",
  },
  // 企业蓝白（类 Ant Design Pro）
  "enterprise-blue": {
    primary: "#1677ff",
    primaryBg: "#1677ff",
    primaryBgHover: "#4096ff",
    surface: "#f0f2f5",
    surfaceAlt: "#ffffff",
    surfaceControl: "#fafafa",
    border: "#d9d9d9",
    borderControl: "#d9d9d9",
    focusRing: "#1677ff",
    text: "#000000e0",
    textMuted: "#00000073",
    textSubtle: "#00000040",
    danger: "#ff4d4f",
    dangerBg: "#fff1f0",
    success: "#52c41a",
    radius: "sm",
    density: "compact",
  },
  // 干净浅色（类 Element Plus）
  "clean-light": {
    primary: "#4096ff",
    primaryBg: "#4096ff",
    primaryBgHover: "#66b1ff",
    surface: "#ffffff",
    surfaceAlt: "#fafafa",
    surfaceControl: "#f5f7fa",
    border: "#e8e8e8",
    borderControl: "#e4e7ed",
    focusRing: "#4096ff",
    text: "#141414",
    textMuted: "#8c8c8c",
    textSubtle: "#c0c4cc",
    danger: "#f5222d",
    dangerBg: "#fff1f0",
    success: "#52c41a",
    radius: "md",
    density: "relaxed",
  },
  // 极简深色（类 shadcn/ui）
  "minimal-dark": {
    primary: "#fafafa",
    primaryBg: "#fafafa",
    primaryBgHover: "#e4e4e7",
    surface: "#09090b",
    surfaceAlt: "#18181b",
    surfaceControl: "#1f1f23",
    border: "#27272a",
    borderControl: "#3f3f46",
    focusRing: "#fafafa",
    text: "#fafafa",
    textMuted: "#a1a1aa",
    textSubtle: "#71717a",
    danger: "#ef4444",
    dangerBg: "#271b1e",
    success: "#22c55e",
    radius: "lg",
    density: "comfortable",
  },
  // custom 不预设值，完全由 styleTokens 决定
  "custom": {},
};

/** 将主题预设与用户自定义 token 合并 */
export function resolveThemeTokens(
  theme: ThemeStyle | undefined,
  customTokens?: StyleToken,
): StyleToken {
  const base = THEME_PRESETS[theme ?? "forge-default"];
  return { ...base, ...customTokens };
}
```

### 5.4 渲染器接入

#### 5.4.1 在 GeneratedPage 挂载时注入 CSS 变量

在 [features/pages/GeneratedPage.tsx](../../src/features/pages/GeneratedPage.tsx) 中增加 effect：

```typescript
import { useEffect } from "react";
import { resolveThemeTokens } from "./themePresets";

// 在 GeneratedPage 组件内部
const tokens = resolveThemeTokens(page.theme, page.styleTokens);

useEffect(() => {
  const root = document.documentElement;
  // 将所有 token 写入 CSS 变量
  Object.entries(tokens).forEach(([key, value]) => {
    if (value === undefined) return;
    const cssVar = `--fg-${key}`;
    root.style.setProperty(cssVar, value);
  });
  // 密度控制整体间距缩放
  if (tokens.density) {
    root.style.setProperty("--fg-density", tokens.density);
  }
  // 清理：组件卸载时保留变量（避免影响其他页面）
  return () => {
    Object.keys(tokens).forEach((key) => {
      root.style.removeProperty(`--fg-${key}`);
    });
    root.style.removeProperty("--fg-density");
  };
}, [page.theme, page.styleTokens]);
```

#### 5.4.2 CSS 变量化改造

将现有 CSS 中的硬编码颜色替换为 `var(--fg-xxx)` 引用，带 fallback 保证向后兼容：

**`route.css` 根变量区改造示例**：

```css
:root {
  /* 原有变量保留，新增 theme token 前缀 */
  --font-ui: 'Manrope', system-ui, sans-serif;
  --font-mono: 'DM Mono', ui-monospace, monospace;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px;
  --control-h: 38px;
  --control-radius: 8px;
  --surface-control: var(--fg-surface-control, #101720);
  --border-control: var(--fg-border-control, #2d3949);
  --focus-ring: var(--fg-focus-ring, #d5fa61);
  --fg-density: comfortable; /* compact=0.85, comfortable=1, relaxed=1.15 */
}

/* 密度映射 */
:root:not([data-density]) { --density-scale: 1; }
[data-density="compact"]    { --density-scale: 0.85; }
[data-density="comfortable"]{ --density-scale: 1; }
[data-density="relaxed"]    { --density-scale: 1.15; }
```

**`generated.css` 关键样式改造示例**（仅展示核心模式）：

```css
/* 原来 */
.generated-page { background: #0b0e13; color: #e9edf5; }
/* 改为 */
.generated-page {
  background: var(--fg-surface, #0b0e13);
  color: var(--fg-text, #e9edf5);
}

.mutation-box {
  background: var(--fg-surface-alt, #10151d);
  border: 1px solid var(--fg-border, #252e3a);
}

/* 按钮颜色 */
.primary {
  background: var(--fg-primary-bg, #d5fa61);
  color: var(--fg-surface, #10140e);
}
.primary:hover { background: var(--fg-primary-bg-hover, #e1ff83); }

.danger {
  background: var(--fg-danger-bg, #25171d);
  color: var(--fg-danger, #ff9aa0);
}
.danger:hover { border-color: var(--fg-danger, #ff7f86); }

/* 文字层级 */
.eyebrow { color: var(--fg-text-muted, #768195); }
.muted { color: var(--fg-text-subtle, #687187); }

/* 边框 */
.prompt-box { border-color: var(--fg-border-control, #354052); }
```

**改造覆盖范围**（预计约 80 处）：

| CSS 文件 | 需改造的元素数 | 说明 |
|---------|--------------|------|
| `generated.css` | ~40 处 | 组件样式（mutation-box、pagination、view-tabs 等） |
| `route.css` | ~25 处 | 按钮、输入框、modal 等通用样式 |
| `styles.css` | ~15 处 | 全局变量和基础组件 |
| `wide-layout.css` | ~5 处 | 响应式和弹窗样式 |

#### 5.4.3 主题切换的触发时机

两种触发方式并存：

```
方式一：由模型在 PageSpec 中指定（推荐）
  用户 prompt → 模型生成含 theme 字段的 PageSpec → 渲染器自动注入

方式二：用户在 UI 手动切换（快捷）
  页面右上角增加主题切换器 → 直接修改 page.theme state → 重新注入 token
```

在 `GeneratedPage` 的 `PageHeader` 中增加主题切换下拉：

```tsx
// PageHeader.tsx 中增加
<SelectField
  value={page.theme ?? "forge-default"}
  options={[
    { value: "forge-default", label: zh ? "暗色默认" : "Dark Default" },
    { value: "enterprise-blue", label: zh ? "企业蓝白" : "Enterprise Blue" },
    { value: "clean-light", label: zh ? "干净浅色" : "Clean Light" },
    { value: "minimal-dark", label: zh ? "极简深色" : "Minimal Dark" },
  ]}
  onChange={(value) => onThemeChange?.(value as ThemeStyle)}
  ariaLabel={zh ? "切换主题" : "Switch theme"}
/>
```

### 5.5 Prompt 层联动

在系统提示词中增加视觉风格说明，让模型知道可以根据用户意图选择主题：

```
【视觉风格】
用户可能在 prompt 中指定页面主题风格，常见选项：
- enterprise-blue：企业级蓝白风格（类似 Ant Design Pro），适合内部管理后台
- clean-light：干净浅色风格（类似 Element Plus），适合报表和阅读型页面
- minimal-dark：极简深色风格（类似 shadcn/ui），适合数据密集型工具
- forge-default：当前暗色风格（默认），适合大多数场景

如果用户未明确指定，使用 forge-default。
当用户在 prompt 中提到"浅色"、"企业蓝"、"干净"、"简约深色"等关键词时，
对应设置 theme 字段。
在 PageSpec 中设置 theme 字段，示例：
{ ..., "theme": "enterprise-blue", ... }
```

同时更新 [promptTemplates.ts](../../src/features/workbench/promptTemplates.ts) 中各 scene 的系统提示词，加入视觉风格描述：

```typescript
{
  id: "dashboard",
  name: "Dashboard",
  scene: "dashboard",
  systemPrompt: "Emphasize stats, trend analysis, and chart views when supported. Use a clean-light or enterprise-blue theme for data-heavy dashboards."
},
{
  id: "crud",
  name: "CRUD 管理",
  scene: "crud",
  systemPrompt: "Emphasize a searchable list and safe create, edit, detail, and delete interactions. Use enterprise-blue for B-end management, forge-default for general use."
}
```

### 5.6 与框架映射方案的关系

Theme Token 与"使用 Ant Design / Element Plus 真实组件库"是两个不同层级的方案：

| 维度 | Theme Token（本文档） | 框架组件映射（后续） |
|------|----------------------|---------------------|
| 改动层次 | 样式层 | 组件层 + 样式层 |
| 是否引入新依赖 | 否 | 是（antd / element-plus） |
| bundle 体积增量 | 0 | +150~200KB |
| 视觉自由度 | 高（颜色/圆角/密度全可控） | 受限于框架组件默认样式 |
| 交互自由度 | 受限于现有组件结构 | 可使用框架原生交互（如 Antd Table 的内置排序/筛选） |
| 实施成本 | 小（约 1 天） | 大（约 2-3 周） |
| 适用场景 | 快速视觉定制、多风格切换 | 需要框架级交互能力的复杂场景 |

**建议路线**：先落地 Theme Token，验证用户确实需要主题切换后，再评估是否需要引入框架映射作为第二阶段。

---

## 6. 实施优先级（含 Theme Token）

| 优先级 | 优化项 | B/C 端 | 收益 | 工作量 | 建议实施阶段 | 当前状态 |
|--------|--------|--------|------|--------|-------------|----------|
| P0 | 系统提示词结构化 + Few-shot | B+C | ⭐⭐⭐⭐⭐ | 小 | Phase 1 | 已完成 |
| P0 | JSON 多层修复策略 | B+C | ⭐⭐⭐⭐ | 小 | Phase 1 | 已完成 |
| P0 | views 流式解析支持 | B+C | ⭐⭐⭐⭐ | 中 | Phase 1 | 已完成 |
| P0 | Theme Token 系统（类型 + 预设 + CSS 变量化） | B+C | ⭐⭐⭐⭐⭐ | 中 | Phase 1 | 已完成 |
| P1 | 新增操作改为弹窗 | C | ⭐⭐⭐⭐⭐ | 中 | Phase 1 | 已完成 |
| P1 | 通用 Modal 组件 | C | ⭐⭐⭐⭐ | 小 | Phase 1 | 已完成 |
| P1 | 删除确认增强（预览信息） | C | ⭐⭐⭐⭐ | 小 | Phase 1 | 已完成 |
| P1 | 编辑弹窗字段实时校验 | B+C | ⭐⭐⭐⭐ | 中 | Phase 1 | 已完成 |
| P1 | Prompt 增加视觉风格说明 | B+C | ⭐⭐⭐⭐ | 小 | Phase 1 | 已完成 |
| P1 | ColumnMeta 字段增强 | B | ⭐⭐⭐⭐ | 中 | Phase 2 | 已完成 |
| P1 | 操作角色智能推断 | B+C | ⭐⭐⭐⭐ | 中 | Phase 2 | 已完成 |
| P2 | 多 View 组合（tabs/split） | B | ⭐⭐⭐ | 大 | Phase 2 | 已完成 |
| P2 | 真实数据绑定（一键替换假数据） | B+C | ⭐⭐⭐⭐ | 大 | Phase 2 | 已完成 |
| P2 | 批量操作支持 | B | ⭐⭐⭐ | 中 | Phase 2 | 已完成 |
| P2 | interaction 字段控制弹窗时机 | C | ⭐⭐⭐⭐ | 中 | Phase 2 | 已完成 |
| P2 | 主题切换器 UI（页面右上角下拉） | B+C | ⭐⭐⭐ | 小 | Phase 2 | 已完成 |
| P3 | B2B 场景预设库 | B | ⭐⭐⭐ | 小 | Phase 3 | 已完成 |
| P3 | C 端专属场景预设（商城/内容/社交） | C | ⭐⭐⭐ | 小 | Phase 3 | 已完成 |
| P3 | 框架组件映射（Ant Design / Element Plus adapter） | B+C | ⭐⭐⭐⭐ | 大 | Phase 3（按需） | 按需未启用 |

---

## 7. 关键文件变更清单（含 Theme Token）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| [features/workbench/PromptComposer.ts](../../src/features/workbench/PromptComposer.ts) | 新增 | 分层 Prompt 组合器 |
| [features/workbench/promptTemplates.ts](../../src/features/workbench/promptTemplates.ts) | 修改 | 引入 Few-shot 模板 + 视觉风格说明 |
| [features/workbench/modelRequest.ts](../../src/features/workbench/modelRequest.ts) | 修改 | 接入 PromptComposer |
| [features/pages/streamingPageParser.ts](../../src/features/pages/streamingPageParser.ts) | 修改 | 多层 JSON 修复 + views 解析 |
| [features/pages/themePresets.ts](../../src/features/pages/themePresets.ts) | 新增 | 内置主题 Token 定义 + resolveThemeTokens() |
| [features/pages/MutationPanel.tsx](../../src/features/pages/MutationPanel.tsx) | 修改 | 重构为通用 Modal 调用 |
| [features/pages/Modal.tsx](../../src/features/pages/Modal.tsx) | 新增 | 通用弹窗组件 |
| [types/domain.ts](../../src/types/domain.ts) | 修改 | 增加 ThemeStyle、StyleToken、InteractionMode、ColumnMeta |
| [wide-layout.css](../../src/wide-layout.css) | 修改 | 集中补充响应式、弹窗样式和生成页面 theme token 覆盖 |
| [features/pages/GeneratedPage.tsx](../../src/features/pages/GeneratedPage.tsx) | 修改 | 接入 theme 注入 effect + interaction 配置 |
| [generated.css](../../src/generated.css) | 修改 | 保留结构与 forge-default fallback；由后加载 Token 层覆盖主题视觉 |
| [route.css](../../src/route.css) | 保留 | 工作台外壳继续使用固定品牌基线，避免生成页主题污染全局导航与配置页 |
| [styles.css](../../src/styles.css) | 保留 | 全局基础样式继续作为 forge-default 与非生成页面 fallback |

---

## 8. 验收标准

### 8.1 提示词优化验收

- [x] 同一 OpenAPI，不同 scene 模板生成差异化的 PageSpec（Dashboard 侧重 stats/chart，CRUD 侧重 operations）
- [ ] Few-shot 示例使模型输出的 JSON Schema 合规率达到 95%+（抽样 50 次）
- [x] JSON 解析失败时降级为用户可读的错误信息，不崩溃

### 8.2 C 端弹窗验收

- [x] 新增操作通过"新增"按钮触发独立弹窗，窄屏适配为底部面板，而非页面底部内联表单
- [x] 编辑/删除操作均通过弹窗完成，不修改页面布局
- [x] 删除弹窗显示删除对象的关键摘要信息
- [x] ESC 键可关闭所有弹窗
- [x] 点击遮罩层可关闭弹窗（danger 变体除外）
- [x] 表单字段根据 fieldSchemas 类型正确渲染（文本/数字/日期/枚举）
- [x] 必填字段为空时提交有即时错误提示
- [x] interaction 字段为 "modal" 时全部走弹窗；为 "inline" 时保持原有行为

### 8.3 Theme Token 验收

- [x] `themePresets.ts` 定义 4 个内置主题（forge-default / enterprise-blue / clean-light / minimal-dark）
- [x] `resolveThemeTokens()` 能正确合并 base preset 与用户自定义 styleTokens
- [x] 页面挂载时 CSS 变量（`--fg-*`）被正确写入 `:root`
- [x] 切换 theme 后，所有组件（按钮、表格、弹窗、筛选器）视觉立即更新
- [x] enterprise-blue 主题下：主色为 `#1677ff`，背景为浅灰 `#f0f2f5`，圆角为 sm
- [x] clean-light 主题下：主色为 `#4096ff`，背景为白色，圆角为 md
- [x] minimal-dark 主题下：主色为 `#fafafa`，背景为近黑 `#09090b`，圆角为 lg
- [x] forge-default 主题下视觉与改造前完全一致（无回归）
- [x] 不含 `theme` 字段的旧版 PageSpec 默认使用 forge-default，视觉不变
- [x] `parsePageSpec` 对不含 theme 的旧模板正常解析，不报错
- [ ] 模型在 prompt 中指定"企业蓝风格"时，生成的 PageSpec 包含 `"theme": "enterprise-blue"`
- [x] 页面右上角主题切换下拉可实时切换 4 种内置主题
- [x] CSS 变量 fallback 值存在（即 `var(--fg-primary-bg, #d5fa61)` 格式），确保旧浏览器不崩溃

### 8.4 实施状态审计（2026-08-25）

本轮已完成提案中的可本地验证实现项：分层 Prompt 与场景 Few-shot、JSON 多层修复及可读失败、递归 View、ColumnMeta、操作角色与 `bodySchema`、字段联动、页面元数据、批量操作、真实数据映射、通用 Modal、C 端 CRUD 弹窗、Theme Token 与主题切换、B2B/C 端预设、`permissionRole` 可见性控制、`sidebar/full/modal` 真实布局、`sortParam` 服务端查询联动、`redirect` 客户端子路由，以及响应式下拉和小屏布局。

| 检查 | 当前证据 |
|------|----------|
| 前端单元测试 | `npm test`：38 passed，覆盖场景差异、B2B/C 端预设、解析修复、字段联动、真实数据映射、主题精确值、安全 token、权限、排序查询、redirect 路由契约、4 项窄视口下拉定位边界及 95% 阈值自动停止 |
| 前端构建 | `npm run build`：通过 |
| Rust 权威校验 | `cargo test`：42 passed，覆盖 PageSpec、OpenAPI 字段联动、操作授权、主题 token、模型输出有界规范化，以及客户端默认模型选择与停用状态 |
| Rust 格式 | `cargo fmt --all -- --check`：通过 |
| 响应式下拉 | Edge/CDP 在 320 / 520 / 1280px 验证；触发器与选项统一为 26px；菜单打开前即获得有效位置，挂载后按真实高度校正并 Portal 到 `BODY`。三个宽度下菜单均可见且四向溢出为 0，320px 下保持触发器宽度并自动向上展开 |
| Theme Token 运行时 | Edge/CDP 对 clean-light / minimal-dark 的内联表单、详情、错误态、弹窗、删除预览、按钮、排序图标与 Portal 下拉读取计算样式，均跟随当前 Token |
| 客户端模型配置 | `npm run validate:model-conformance:config`：脱敏识别默认模型 `Agens · openai · agnes-2.5-flash`，并在 Rust 进程内确认 1 个系统钥匙串引用可解析；Node 不接触凭证 |
| 真实模型一致性 | 正式 50 次分层验收运行到 8 次时出现第 3 个 `invalid-output`，当时 schema-pass 为 5/8；即使后续全通过，最高也只有 47/50（94%），因此提前停止。随后以 Dashboard / CRUD / enterprise-theme 各 1 条执行最小诊断，3/3 均通过；链路和三类语义均可用，但当前供应商输出稳定性尚不足以勾选 95% 验收项 |
| DSL 运行时语义 | Edge/Playwright 在 1280 / 320px 验证：sidebar 两栏自动回落单栏、full 单栏、modal 桌面宽 820px/移动端自适应；四类 redirect 子路由可见且可返回；权限拒绝态可见；320px `scrollWidth === clientWidth` |
| UI 静态检测 | Impeccable detector：0 findings |

真实模型调用已获授权并实际执行，但两项 95% 验收仍未通过：正式抽样在第 8 次出现第 3 个无效输出后已无法达到 95%，因此没有用继续调用或补抽样掩盖失败。企业蓝在正式样本中 2/3 通过，最小诊断样本也通过，说明确定性主题意图解析已经生效，但还不能证明供应商输出达到稳定验收阈值。

仓库已提供可重复验收命令。默认通过本地 Rust 探针复用客户端默认模型：Node 只传入 Prompt、OpenAPI 上下文和允许的操作，Rust 在进程内读取 `model_configs` 元数据与系统钥匙串，并只返回校验后的 PageSpec 或脱敏错误；凭证不会进入环境变量、stdout 或文件，单次输出上限固定为 4096 Token。先运行 `npm run validate:model-conformance:config` 脱敏确认配置，再运行 `npm run validate:model-conformance:dry` 检查 50 次请求编排；真实抽样使用 `npm run validate:model-conformance -- --confirm-paid-calls`。仅在 CI 等无客户端数据库场景下，才显式提供 `MODEL_BASE_URL`、`MODEL_NAME` 和可选的 `MODEL_API_KEY` / `MODEL_PROTOCOL`；真实调用仍必须带确认参数。

Theme Token 的实现采用集中覆盖策略：`generated.css`、`route.css` 和 `styles.css` 保留 forge-default 与工作台外壳基线，后加载的 `wide-layout.css` 只覆盖 `.generated-page` 及其 Portal 弹窗/下拉。这样仍满足生成页面内所有组件实时换肤，同时避免 clean-light 等页面主题把侧边导航、模型配置页一起改色。

P3 的框架组件映射在提案中标注为“按需”，本轮未引入 Ant Design / Element Plus 运行时，现有受控渲染器与 Theme Token 已覆盖当前验收范围。

---

## 9. 风险与缓解

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| LLM 输出 Few-shot 格式漂移 | 模型可能将示例当成输出的一部分 | 在 system prompt 中明确"以下为示例，不要复述" |
| 弹窗组件引入新的 focus trap 问题 | 弹窗打开后焦点可能泄漏 | 使用 `useFocusTrap` 或手动管理 tabbable 元素 |
| C 端弹窗在移动端显示异常 | 全屏弹窗在小屏可能遮挡内容 | 小屏自动切换为底部抽屉（drawer）模式 |
| interaction 字段向后兼容 | 旧 PageSpec 无此字段 | 渲染器检测到 undefined 时使用默认 inline 模式 |
| 真实数据绑定性能 | 多接口并发查询可能导致页面闪烁 | 使用请求合并 + 占位骨架屏，完成后整体替换 |
| CSS 变量 fallback 缺失导致白屏 | 若所有 `var()` 均无 fallback 且变量未设置 | 每个 `var()` 必须带 fallback 值（如 `var(--fg-text, #e9edf5)`） |
| 浅色主题下对比度不足 | enterprise-blue 的 muted 文字可能不够清晰 | 浅色主题中 textMuted 使用 `#00000073` 而非灰色，确保 WCAG AA |
| 主题切换时已有操作状态丢失 | 切换主题不影响功能但可能让用户困惑 | 主题切换仅修改 CSS 变量，不重置任何 state，需明确告知用户 |

---

## 10. 附录：C 端 vs B 端页面对比示意

### B 端页面（传统管理后台）

```
┌─────────────────────────────────────────────┐
│ 标题栏 + 面包屑                              │
├─────────────────────────────────────────────┤
│ [筛选器区域]                                  │
├─────────────────────────────────────────────┤
│ [统计卡片]                                    │
├─────────────────────────────────────────────┤
│ [表格列表]          [新增] [导出]             │
│ ┌──────┬──────┬──────┬──────┬──────────┐   │
│ │序号  │名称  │状态  │操作  │           │   │
│ ├──────┼──────┼──────┼──────┼──────────┤   │
│ │1    │设备A │正常  │查看 编辑 删除│   │
│ └──────┴──────┴──────┴──────┴──────────┘   │
├─────────────────────────────────────────────┤
│ [新增表单 - 页面底部内联]                      │
│ [编辑表单 - 页面底部内联]                      │
└─────────────────────────────────────────────┘
```

### C 端页面（消费者界面）

```
┌─────────────────────────────────────────────┐
│ 标题栏 + 面包屑                              │
├─────────────────────────────────────────────┤
│ [筛选器区域]             [+ 新增]            │
├─────────────────────────────────────────────┤
│ [统计卡片]                                    │
├─────────────────────────────────────────────┤
│ [表格列表]          [导出]                    │
│ ┌──────┬──────┬──────┬──────┬──────────┐   │
│ │序号  │名称  │状态  │操作  │           │   │
│ ├──────┼──────┼──────┼──────┼──────────┤   │
│ │1    │设备A │正常  │查看 编辑 删除│   │
│ └──────┴──────┴──────┴──────┴──────────┘   │
├─────────────────────────────────────────────┤
│ （无内联表单区域）                            │
└─────────────────────────────────────────────┘
        ↓ 点击"新增" / "编辑" / "删除" / "查看"
┌─────────────────────────────────────────────┐
│  ████████████████████████████████████████   │
│  █                                        █   │
│  █   新增设备                    [×]      █   │
│  █   ─────────────────────────────────    █   │
│  █   名称：[____________]                  █   │
│  █   状态：[请选择 ▼]                      █   │
│  █   备注：[____________]                  █   │
│  █                                        █   │
│  █            [取消]    [提交]            █   │
│  █                                        █   │
└─────────────────────────────────────────────┘
```
