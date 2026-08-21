# Forge UI

Forge UI 是一个本地优先的 Tauri 2 桌面客户端。它导入 Swagger 2.0 / OpenAPI 3.x 文档，通过自定义大模型配置生成受控 `PageSpec`，并在用户主动操作后查询或修改业务 API 数据。

## 已实现

- Windows Tauri 安装包（MSI、NSIS）构建链路已验证。
- OpenAI Compatible 和 Anthropic Compatible 模型配置、连接测试及结构化页面生成。
- Swagger/OpenAPI 规范 URL、Swagger UI 静态发现与本地规范解析。
- 查询、筛选、分页、详情、新增、编辑、删除确认、统计柱状图、CSV 和 XLSX 导出。
- SQLite 保存模型元数据、业务连接、模板、模板版本与回滚记录；启动时自动备份，并可在客户端列出、校验和恢复本地备份。
- Windows Credential Manager / macOS Keychain 保存模型和业务 API 密钥。
- Bearer Token、API Key、企业 CA PEM；不会关闭 TLS 校验。
- 模型自定义 Header 值仅保存到系统钥匙串，SQLite 只保存 secretRef。
- 模板保存、版本历史、恢复、导入和导出。

## 本地开发

```powershell
npm install
npm run build
C:\Users\goodk\.cargo\bin\cargo.exe test --manifest-path src-tauri\Cargo.toml
npm run tauri:dev
```

`npm run dev` 仅启动浏览器预览。要验证系统钥匙串、SQLite、Rust 网络请求和 IPC，请使用 `cargo-tauri dev`。

## 验证

```powershell
npm audit --audit-level=high
npm run build
C:\Users\goodk\.cargo\bin\cargo.exe check --manifest-path src-tauri\Cargo.toml
C:\Users\goodk\.cargo\bin\cargo.exe test --manifest-path src-tauri\Cargo.toml --lib
npm run tauri:build -- --debug
```

## 安全边界

- API Key、Bearer Token 和模型 Key 不写入 SQLite、模板或导出文件。
- 模型只能返回受限 JSON `PageSpec`，不会执行模型生成的 JavaScript/HTML。
- 删除操作必须由用户确认。
- 仅允许 HTTPS；调试环境允许 localhost。
- 企业 CA 只作为额外信任根，不能绕过 TLS 证书校验。

## 正式发布

Windows 签名、Tauri 更新签名/更新地址、macOS 签名与公证需要外部凭证。详见 [docs/release.md](docs/release.md)。
