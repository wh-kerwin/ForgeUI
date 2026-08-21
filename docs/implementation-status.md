# 实现状态

## 已完成

- Tauri 目标架构下的 React/Vite 工作台界面。
- OpenAI Compatible / Anthropic Compatible 模型协议选择。
- 模型名称、Base URL、API Key、Temperature、最大 Token、流式输出配置。
- 模型配置切换、保存、连接测试占位和本地持久化。
- 模型自定义 Header 值使用系统钥匙串保存，SQLite 只保存名称和 secretRef。
- 生成式页面提示输入和受控 UI DSL 的产品入口设计。
- 响应式深色工作台视觉样式。
- SQLite WAL、启动备份、备份列表、完整性校验、恢复前自动备份与受控恢复。
- Windows release MSI/NSIS 构建验证；Rust 22 项单元测试、前端生产构建和 npm audit 验证。
- 可选 `updater` feature、签名更新检查/安装 IPC 与客户端检查更新入口；正式 endpoint/公钥通过发布配置注入。

## 仍需发布凭证或跨平台环境的事项

- Tauri updater 公钥/私钥与 HTTPS 更新清单（需要发布方真实凭证，模板已提供）。
- Windows 代码签名、macOS 签名、公证和跨平台安装/更新测试。
- 真实模型、OpenAPI、业务 API mock server 的端到端测试。

## 已验证安全门禁

- OpenAPI operation 允许列表在 Rust 层校验，PageSpec 绑定不能越权。
- 模型流式 SSE 必须完整拼接后才能产生 PageSpec。
- 模型、业务 API、OpenAPI 响应均有 Content-Length 和逐块读取上限。
- 页面修改上下文脱敏，不向模型发送真实业务 rows/stats。
