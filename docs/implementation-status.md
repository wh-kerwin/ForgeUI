# 实现状态

## 已完成

- Tauri 目标架构下的 React/Vite 工作台界面。
- OpenAI Compatible / Anthropic Compatible 模型协议选择。
- 模型名称、Base URL、API Key、Temperature、最大 Token、流式输出配置。
- 模型配置切换、保存、连接测试和本地持久化。
- 模型自定义 Header 值使用系统钥匙串保存，SQLite 只保存名称和 secretRef。
- 生成式页面提示输入和受控 UI DSL 的产品入口设计。
- C 端总览、生成工作台、独立模板库和配置 readiness 入口。
- 模板上下文生成、模板版本更新、搜索、固定、重命名、恢复、导入导出和 PageSpec 前端校验。
- OpenAPI 摘要和授权 operation 随业务连接持久化并在启动时恢复。
- Workbench 模型操作、生成视图和模板视图按 hooks/组件边界拆分。
- 响应式深色工作台视觉样式。
- SQLite WAL、启动备份、备份列表、完整性校验、恢复前自动备份与受控恢复。
- Windows release MSI/NSIS 构建验证；Rust 22 项单元测试、前端生产构建和 npm audit 验证。
- 可选 `updater` feature、签名更新检查/安装 IPC 与客户端检查更新入口；正式 endpoint/公钥通过发布配置注入。

## 仍需发布凭证或跨平台环境的事项

- Tauri updater 公钥/私钥与 HTTPS 更新清单（需要发布方真实凭证，模板已提供）。
- Windows 代码签名、macOS 签名、公证和跨平台安装/更新测试。
- 真实模型、OpenAPI、业务 API mock server 的端到端测试。

## 当前验证结果

- Rust 1.98：22 项单元测试全部通过。
- TypeScript/Vite 生产构建通过。
- npm 高危审计无漏洞。
- Rust 格式检查通过。

## 已验证安全门禁

- OpenAPI operation 允许列表在 Rust 层校验，PageSpec 绑定不能越权。
- 模型流式 SSE 必须完整拼接后才能产生 PageSpec。
- 模型、业务 API、OpenAPI 响应均有 Content-Length 和逐块读取上限。
- 页面修改上下文脱敏，不向模型发送真实业务 rows/stats。
