# 发布与 Rust 工具链说明

## Rust/Cargo

当前项目使用 Tauri 2 与 Rust stable 工具链。只要以下命令在 `src-tauri` 目录通过，就不需要为了本项目单独升级 Rust：

```powershell
cargo fmt --check
cargo test --lib
cargo tauri build
```

升级 Rust 只有在 Tauri、插件或依赖明确要求更高 `rust-version`，或当前 stable 无法编译时才进行。升级前应保留 `rust-toolchain.toml`/锁文件并重新执行完整构建。

## 发布前置

自动更新和正式安装包签名需要发布方提供真实凭证：

- Tauri updater 公钥与签名私钥（私钥只放在发布机密管理系统）。
- Windows 代码签名证书及密码。
- macOS Developer ID 证书、App Store Connect 公证凭证。
- 更新清单 URL 与各平台制品 URL。

未提供这些凭证时，开发构建和本地 MSI/NSIS 验证可以继续，但不应生成伪造签名配置或把密钥写入仓库。
