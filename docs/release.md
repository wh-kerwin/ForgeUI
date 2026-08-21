# Forge UI 正式发布清单

## Windows

准备受信任的代码签名证书（PFX 或硬件/云签名服务）后，对 MSI 和 NSIS 产物执行签名与时间戳。不要把证书或密码提交到仓库。

需要的产物：

- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`

建议先在隔离 Windows 虚拟机验证安装、升级、卸载、钥匙串读取、OpenAPI 导入和模型调用。

## 自动更新

生成 Tauri 更新密钥对，并将私钥保存在 CI 密钥存储中。把公钥配置到 `tauri.conf.json` 的 updater 配置；发布端需要通过 HTTPS 提供签名过的更新 manifest 和安装包。私钥、私钥密码和更新源地址由发布负责人提供后再写入 CI 配置，不能使用示例值替代。

客户端已包含可选 updater feature、签名校验和“检查更新”入口。默认开发构建不启用更新器；正式发布时复制 `src-tauri/tauri.updater.template.json` 到受保护的发布配置，替换公钥和 HTTPS endpoint 后执行：

```powershell
cargo tauri build --features updater --config src-tauri/tauri.updater.release.json
```

`tauri.updater.release.json` 不应提交到仓库，私钥只用于 CI 签名步骤。更新下载由 Tauri updater 完成签名校验后才安装，客户端没有忽略 TLS 校验的开关。

CI 在构建前应执行配置门禁：

```powershell
npm run validate:updater -- src-tauri/tauri.updater.release.json
```

## macOS

需要 macOS 构建机以及 Apple Developer 团队配置：

- Developer ID Application 证书
- Developer ID Installer 证书（如发布 PKG）
- App-specific password 或 App Store Connect API 凭证用于公证

必须在 macOS 上执行打包、签名、公证和 Gatekeeper 验证；Windows 环境不能证明 macOS 产物可用。

## 发布门禁

```powershell
npm audit --audit-level=high
npm run build
C:\Users\goodk\.cargo\bin\cargo.exe test --manifest-path src-tauri\Cargo.toml --lib
npm run tauri:build
```

发布前确认模板导出文件、SQLite 数据库和应用日志中不存在模型或业务凭证。

`.github/workflows/ci.yml` 会在 Windows 和 macOS 上执行无凭证验证。正式发布流水线应复用这些门禁，并额外注入 updater 公钥、签名私钥、Windows 证书或 macOS 公证凭证；这些机密不进入普通 CI 和代码仓库。
