# Forge UI

Forge UI 是一个本地优先的 Tauri 2 桌面客户端：连接已有的后台 API，用自然语言生成可运行的 Dashboard、查询、详情和 CRUD 页面，不需要为每个后台服务重复编写固定前端。

产品从总览页开始，用户可以查看模型/API/模板就绪状态，进入生成工作台，用对话定义页面交互，并把满意的页面保存为可搜索、可固定、可重命名和可版本回滚的模板。后续生成时，已保存模板可以作为安全的结构上下文复用。

## 已实现

- Windows Tauri 安装包（MSI、NSIS）构建链路已验证。
- OpenAI Compatible 和 Anthropic Compatible 模型配置、连接测试及结构化页面生成。
- Swagger/OpenAPI 规范 URL、Swagger UI 静态发现与本地规范解析。
- 查询、筛选、分页、详情、新增、编辑、删除确认、统计柱状图、CSV 和 XLSX 导出。
- 总览、生成工作台和独立模板库；模板搜索、固定、重命名、版本恢复、导入导出与模板上下文复用。
- SQLite 保存模型元数据、业务连接、模板、模板版本与回滚记录；启动时自动备份，并可在客户端列出、校验和恢复本地备份。
- OpenAPI 摘要和授权 operation 随业务连接恢复；应用重启后无需重复导入规范。
- Windows Credential Manager / macOS Keychain 保存模型和业务 API 密钥。
- Bearer Token、API Key、企业 CA PEM；不会关闭 TLS 校验。
- 模型自定义 Header 值仅保存到系统钥匙串，SQLite 只保存 secretRef。
- 受控 `PageSpec` 校验、模板保存、版本历史、恢复、搜索、固定、重命名、导入和导出。

## 本地开发

```powershell
npm install
npm run build
C:\Users\admin\.cargo\bin\cargo.exe fmt --manifest-path src-tauri\Cargo.toml -- --check
C:\Users\admin\.cargo\bin\cargo.exe test --manifest-path src-tauri\Cargo.toml
npm run tauri:dev
```

`npm run dev` 仅启动浏览器预览。要验证系统钥匙串、SQLite、Rust 网络请求和 IPC，请使用 `npm run tauri:dev`。

## 验证

```powershell
npm audit --audit-level=high
npm run build
C:\Users\admin\.cargo\bin\cargo.exe check --manifest-path src-tauri\Cargo.toml
C:\Users\admin\.cargo\bin\cargo.exe test --manifest-path src-tauri\Cargo.toml --lib
npm run tauri:build -- --debug
```

## 安全边界

- API Key、Bearer Token 和模型 Key 不写入 SQLite、模板或导出文件。
- 模型只能返回受限 JSON `PageSpec`，不会执行模型生成的 JavaScript/HTML。
- 删除操作必须由用户确认。
- 仅允许 HTTPS；调试环境允许 localhost。
- 企业 CA 只作为额外信任根，不能绕过 TLS 证书校验。

## 正式发布

### GitHub 手动打包

仓库包含 `Build desktop installers` workflow。在 GitHub 仓库中打开 **Actions → Build desktop installers → Run workflow → Run workflow**。两个平台构建完成后，在该次运行底部的 **Artifacts** 下载：

- `forge-ui-windows-*`：Windows MSI `.msi` 安装包。
- `forge-ui-macos-*`：macOS `.dmg` 安装包。

安装包版本读取 `src-tauri/tauri.conf.json` 中的 `version`。当前 workflow 生成未签名安装包，仅用于内部测试；Windows SmartScreen 和 macOS Gatekeeper 可能显示安全提示。

### 创建 Release 并自动关联安装包

1. 提交发布版本代码，并确保 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `package.json` 中的版本一致。
2. 在 GitHub 打开 **Releases → Draft a new release**。
3. 创建或选择版本标签（例如 `v0.2.0`），目标分支选择 `main`。
4. 点击 **Publish release**。保存草稿不会触发打包，正式发布才会触发。
5. `Build desktop installers` workflow 会从该标签构建 Windows 和 macOS；两个平台成功后，MSI 和 DMG 会自动追加到该 Release 的 **Assets**。

如果上传 Assets 返回 `403 Resource not accessible by integration`，请在 **Settings → Actions → General → Workflow permissions** 中允许 GitHub Actions 使用读写权限。

Windows 签名、Tauri 更新签名/更新地址、macOS 签名与公证需要外部凭证。详见 [docs/release.md](docs/release.md)。
