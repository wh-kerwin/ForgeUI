# 本地生成式业务 UI 客户端 MVP 计划（含自定义模型配置）

## Summary

构建 Windows/macOS 桌面客户端。用户输入 Swagger/OpenAPI URL 或导入本地文件，客户端解析接口并通过 AI 动态生成查询、统计、图表、表单和 CRUD 页面。

客户端本地保存连接、模型配置、模板和历史记录。页面使用受控 UI DSL 渲染，AI 不生成或执行任意前端代码。

技术栈：

- Tauri 2 + Rust
- React + TypeScript + Vite
- SQLite
- Windows Credential Manager / macOS Keychain
- Windows/macOS 签名安装包与自动更新

## Key Changes

### 1. 自定义模型配置

客户端新增“模型服务配置”管理模块，允许用户创建多个模型配置并切换当前使用的模型。

每个配置包含：

- 配置名称
- API 格式：OpenAI Compatible 或 Anthropic Compatible
- 请求 Base URL
- API Key
- 模型名称
- 自定义请求 Header
- 请求超时时间
- Temperature
- 最大输出 Token
- 结构化输出模式
- 是否启用流式输出
- 备注和启用状态

MVP 默认支持：

- OpenAI Chat Completions 兼容协议。
- Anthropic Messages 兼容协议。

内部统一抽象为 `ModelProviderAdapter`：

```text
generateStructured()
generateText()
streamText()
validateConnection()
```

不同协议由 Rust 适配器负责转换：

- OpenAI：`/chat/completions`
- Anthropic：`/messages`
- 结构化输出优先使用 JSON Schema 或 JSON Object 模式。
- 如果供应商不支持原生结构化输出，则使用严格提示词加 JSON 解析和 Schema 校验兜底。

模型配置只保存元数据到 SQLite；API Key 只保存到系统钥匙串。SQLite 中保存 `secretRef`，不保存明文密钥。

### 2. 模型配置操作

提供以下功能：

- 新增、编辑、复制、删除模型配置。
- 设置默认模型。
- 在生成页面前切换模型。
- “测试连接”按钮。
- 显示模型名称、协议、响应耗时和错误原因。
- 连接测试不得携带真实业务数据，只发送最小测试提示。
- API Key 在界面中默认掩码显示。
- 配置导出时不包含 API Key。
- 删除配置前检查是否被模板或会话引用。

模型配置与业务 API 连接分离管理：

```text
模型配置：负责 AI 请求
业务连接：负责 Swagger 和业务 API 请求
页面模板：引用 operation 和模型生成结果，但不嵌入密钥
```

### 3. 模型安全策略

- 只允许 HTTPS；开发环境可显式允许 localhost。
- 支持系统证书信任库和按连接导入企业 CA。
- 禁止提供“一键忽略 TLS 校验”。
- Base URL、代理地址和自定义 Header 均通过 Rust 校验。
- 屏蔽 `file:`、`data:`、`javascript:` 等协议。
- 不向模型发送真实业务响应、业务凭证或无关本地数据。
- 日志脱敏 API Key、Authorization、Cookie 和自定义敏感 Header。
- 模型请求超时、响应大小、重试次数和取消机制可配置但有安全上限。
- 对模型输出执行 JSON Schema 校验；非法输出最多自动修复一次。

## Architecture

```text
React UI
  ├─ 模型配置页
  ├─ Swagger/业务连接页
  ├─ AI 对话与页面预览
  └─ UI DSL Renderer
          │ Tauri IPC
          ▼
Rust Core
  ├─ ModelProviderAdapter
  │    ├─ OpenAI Adapter
  │    └─ Anthropic Adapter
  ├─ Swagger Fetcher/Parser
  ├─ Business API Executor
  ├─ UI DSL Validator
  ├─ SQLite Repository
  ├─ System Keychain
  ├─ CSV/XLSX Exporter
  └─ Auto Updater
```

React 不直接访问模型服务、Swagger 服务或业务 API。所有网络请求、凭证使用、TLS 校验和响应解析均由 Rust 完成，从而避免 CORS 和 WebView 暴露密钥。

## Swagger/OpenAPI

支持：

- OpenAPI 3.0、3.1。
- Swagger 2.0，并转换到统一内部模型。
- 直接 JSON/YAML 规范 URL。
- Swagger UI 页面自动发现配置中的 `url`、`urls`、`configUrl`。
- 本地 JSON/YAML 文件。

导入过程：

1. 获取用户输入 URL。
2. JSON/YAML 响应直接解析。
3. HTML 响应只做静态配置分析，不执行页面脚本。
4. 发现多个规范时让用户选择。
5. 自动发现失败时允许粘贴真实规范 URL或导入文件。
6. 系统建议资源分组和 CRUD/统计角色，用户确认后才允许调用。

## UI DSL 与业务能力

组件范围：

- 文本、数字、日期、日期区间、单选、多选、布尔筛选器。
- 统计指标卡。
- 表格、排序、分页和字段格式化。
- 详情面板。
- 折线图、柱状图、饼图。
- 新增和编辑表单。
- 删除二次确认。
- CSV/XLSX 导出。
- 加载、空态、错误和无权限状态。

页面可以绑定多个已授权 operation：

- 列表。
- 详情。
- 新增。
- 编辑。
- 删除。
- 统计。
- 其他只读数据源。

AI 只生成 `PageSpec` 声明式 DSL，不生成 JavaScript、React、HTML 或 CSS。所有 DSL 均通过版本化 JSON Schema 校验。

统计和图表优先使用统计接口。只有在页面明确标注口径时，才允许对当前已加载结果进行 count、sum、avg、min、max 和简单分组。

所有新增、编辑和删除操作必须由用户在页面中主动提交。AI 不直接执行写操作。

## 本地数据与模板

SQLite 保存：

- Swagger/OpenAPI 规范缓存。
- 业务连接元数据。
- operation 分组和授权。
- 模型配置元数据。
- 生成会话。
- 页面模板及版本。
- 应用设置和数据库迁移信息。

系统钥匙串保存：

- 业务 API Key。
- Bearer Token。
- 模型 API Key。
- 其他敏感自定义 Header。

模板支持：

- 临时页面保存为本地草稿。
- 版本历史、差异和回滚。
- 固定到客户端导航。
- 导入/导出可移植模板文件。
- 导出文件不包含 API Key、Token、企业 CA 私钥和真实业务数据。
- 导入后根据 operationId、路径和 Schema 指纹重新绑定本地业务连接。

## 安全与故障处理

- Tauri 使用最小 IPC 权限和严格 CSP。
- 不加载或执行远程 Swagger 页面。
- URL、Host、协议、重定向和 DNS 解析经过校验，防止 SSRF。
- 请求设置连接超时、总超时、响应大小限制和取消能力。
- 业务 API 未授权 operation 一律拒绝。
- 上游服务不可用时保留现有页面和模板。
- 模型失败时显示协议、HTTP 状态、超时或 Schema 错误。
- SQLite 使用事务和自动备份。
- 自动更新校验签名，失败时拒绝安装。

## Implementation Phases

1. 初始化 Tauri 2、React、TypeScript、Rust 和跨平台构建。
2. 实现 SQLite、系统钥匙串和 IPC 权限边界。
3. 实现模型配置 CRUD、密钥引用、默认模型和测试连接。
4. 实现 OpenAI/Anthropic 协议适配器、结构化输出和流式输出。
5. 实现 Swagger URL、本地文件、Swagger UI 自动发现和版本转换。
6. 实现业务连接、认证、企业 CA、operation 授权和 Rust API 执行器。
7. 定义 UI DSL Schema、组件注册表和页面渲染器。
8. 实现 AI 页面生成、校验、修复和对话式修改。
9. 实现筛选、统计、图表、表格、详情和 CRUD。
10. 实现 CSV/XLSX 导出。
11. 实现模板保存、版本、回滚、固定导航和无密钥导入导出。
12. 实现 Windows/macOS 签名、自动更新、备份恢复。
13. 完成跨平台、安全和端到端测试。

## Tests and Acceptance

- OpenAI Compatible 和 Anthropic Compatible 配置均可测试连接。
- 错误 Base URL、错误 API Key、超时、非 JSON 响应和不支持的协议有明确提示。
- 模型 API Key 不会出现在 SQLite、日志、WebView、模板或崩溃报告。
- 不同模型配置可以生成同一份合法 `PageSpec`。
- 供应商不支持原生 JSON Schema 时，JSON 兜底解析仍能工作。
- 流式输出中断后页面不会产生半份可执行 DSL。
- OpenAPI 3.0、3.1、Swagger 2.0 和 Swagger UI URL 均可导入或给出明确失败原因。
- 未授权 operation、伪造目标 URL 和非法 IPC 参数会被拒绝。
- 页面能完成查询、统计、图表、详情、新增、编辑、删除和导出。
- 删除必须二次确认；Schema 校验失败时保留用户输入。
- 模板导出不含任何密钥和真实数据，重新导入后可以重新绑定本地连接。
- Windows/macOS 均完成模型请求、企业 CA、钥匙串、安装、更新和卸载测试。

## ADRs

计划中记录以下架构决策：

- `ADR-001`: 使用 Tauri 2 而非 Electron。
- `ADR-002`: 支持 OpenAI Compatible 与 Anthropic Compatible 双协议适配器。
- `ADR-003`: 密钥只存系统钥匙串，SQLite 只存引用。
- `ADR-004`: 模型、业务 API 和页面模板采用分离配置模型。
- `ADR-005`: AI 输出受控 UI DSL，不执行模型生成代码。
- `ADR-006`: Swagger UI 只静态发现规范地址，不执行远程页面脚本。
