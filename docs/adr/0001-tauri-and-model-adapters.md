# ADR-001: Tauri 2 与本地模型适配器

## Status

Accepted for MVP

## Decision

使用 Tauri 2 承载 React UI；所有模型请求、Swagger 获取、业务 API 调用和密钥访问由 Rust IPC 层负责。模型协议通过适配器统一为 OpenAI Compatible 与 Anthropic Compatible。

## Consequences

- WebView 不接触 API Key，避免 CORS 和前端密钥泄漏。
- 安装包和空闲内存更小。
- 需要 Rust/Cargo 环境才能编译桌面壳和系统钥匙串能力。

## Current implementation note

当前工作区先交付 React 可运行垂直切片；模型配置使用 localStorage 作为临时开发存储，正式实现必须替换为 SQLite 元数据 + Windows Credential Manager/macOS Keychain。
