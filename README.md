# Forge UI

Forge UI 是一个本地优先的生成式业务 UI 桌面客户端。它连接已有的 Swagger/OpenAPI 服务，通过自然语言生成可查询、可操作、可保存复用的业务页面，减少为不同后台接口重复开发固定前端的工作。

项目基于 Tauri 2、React 和 Rust 构建，支持 Windows 与 macOS。模型请求、业务 API 请求、凭证读取和数据持久化统一由 Rust 侧处理，WebView 仅负责界面展示与交互。

## 核心能力

- 配置多个 OpenAI Compatible 或 Anthropic Compatible 模型服务，并选择默认模型。
- 测试模型连接，配置 Base URL、模型名称、API Key、自定义 Header 和生成参数。
- 从规范 URL、Swagger UI 地址或本地 JSON/YAML 文件导入 API 文档。
- 解析 Swagger 2.0、OpenAPI 3.0 和 OpenAPI 3.1，并按 operation 控制页面访问权限。
- 使用自然语言生成查询、统计、图表、详情和 CRUD 页面。
- 支持筛选、排序、分页、编辑弹窗、删除确认以及 CSV/XLSX 导出。
- 通过受控 `PageSpec` DSL 渲染页面，不执行模型生成的 HTML、CSS 或 JavaScript。
- 保存生成页面为模板，支持搜索、固定、重命名、版本恢复和导入导出。
- 保存生成历史、本地数据库备份及恢复记录。
- 提供中文和英文界面。

## 工作方式

```text
Swagger / OpenAPI ──┐
                    ├──> Rust Core ──> AI 生成 PageSpec ──> React DSL Renderer
Model Provider ─────┘         │                              │
                              ├──> Business API Executor <───┘
                              ├──> SQLite
                              └──> System Keychain
```

1. 配置并测试模型服务。
2. 导入 Swagger/OpenAPI 文档，配置业务认证并授权可用 operation。
3. 在生成工作台描述需要的查询、统计或数据操作页面。
4. 客户端校验模型返回的 `PageSpec`，然后使用内置组件渲染页面。
5. 满意的页面可保存为模板，后续直接打开或作为生成上下文复用。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面运行时 | Tauri 2 |
| 前端 | React、TypeScript、Vite |
| Rust 核心 | Rust、Serde、Reqwest、rustls |
| 本地存储 | SQLite、rusqlite |
| 密钥存储 | Windows Credential Manager、macOS Keychain |
| 数据导出 | CSV、rust_xlsxwriter |
| 图标 | Lucide React |
| 持续集成 | GitHub Actions |

## 项目结构

```text
ForgeUI/
├─ .github/workflows/        # CI 与桌面安装包构建
├─ docs/                     # 产品、设计、计划和架构决策文档
├─ scripts/                  # 项目校验脚本
├─ src/                      # React 前端
│  ├─ app/                   # 客户端路由与应用状态
│  ├─ constants/             # 默认配置
│  ├─ features/              # 按业务能力拆分的页面与组件
│  │  ├─ business/           # 业务 API 连接
│  │  ├─ models/             # 模型配置
│  │  ├─ openapi/            # OpenAPI 文档与 operation 授权
│  │  ├─ overview/           # 项目总览
│  │  ├─ pages/              # PageSpec 渲染与页面操作
│  │  ├─ sessions/           # 生成历史
│  │  ├─ templates/          # 页面模板
│  │  └─ workbench/          # AI 生成工作台
│  ├─ i18n/                  # 中英文切换
│  ├─ lib/tauri/             # Tauri IPC 调用封装
│  └─ types/                 # TypeScript 领域类型
├─ src-tauri/                # Tauri 与 Rust 核心
│  ├─ capabilities/          # Tauri 权限配置
│  ├─ icons/                 # 客户端图标
│  └─ src/
│     ├─ domain/             # PageSpec 领域模型与 Schema 校验
│     ├─ repositories/       # SQLite、迁移、配置和密钥存储
│     └─ services/           # 模型、OpenAPI、业务 API、导出与 URL 安全
├─ package.json
└─ rust-toolchain.toml
```

## 开始开发

### 环境要求

- Node.js 22 或更高版本
- npm
- Rust 1.88 或更高版本
- [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)

Windows 开发需要 Microsoft C++ Build Tools 和 WebView2；macOS 开发需要 Xcode Command Line Tools。

### 安装与启动

```bash
git clone https://github.com/wh-kerwin/ForgeUI.git
cd ForgeUI
npm ci
npm run tauri:dev
```

模型和业务服务均在客户端内配置，不需要创建 `.env` 文件。

`npm run dev` 只启动浏览器界面预览。SQLite、系统钥匙串、Rust 网络请求和 Tauri IPC 需要通过 `npm run tauri:dev` 调试。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 浏览器预览 |
| `npm run tauri:dev` | 启动桌面客户端开发模式 |
| `npm run build` | 执行 TypeScript 检查并构建前端 |
| `npm run preview` | 预览前端生产构建 |
| `npm run tauri:build` | 构建桌面客户端安装包 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 检查 Rust 格式 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 检查 Rust 编译 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 运行 Rust 单元测试 |

## 本地数据与安全边界

- SQLite 保存模型元数据、业务连接、OpenAPI 摘要、模板、版本和生成历史。
- 模型 API Key、业务 Token 和敏感自定义 Header 只保存到系统钥匙串。
- 模板和导出文件不包含密钥或真实业务响应数据。
- React 不直接请求模型服务、Swagger 服务或业务 API，相关请求通过 Tauri IPC 交给 Rust。
- 模型只接收页面结构和已授权 operation，不接收已加载的真实业务数据或业务凭证。
- 远程地址默认要求 HTTPS；开发模式仅对 localhost 放行 HTTP。
- Swagger UI 只用于静态发现规范地址，不加载或执行远程页面脚本。
- 新增、编辑和删除操作必须由用户主动提交，删除操作需要二次确认。

## 构建

```bash
npm ci
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。仓库中的 GitHub Actions 会在推送和 Pull Request 时执行跨平台检查，并在 GitHub Release 发布后构建 Windows MSI 与 macOS DMG 安装包。

当前安装包未进行 Windows 代码签名或 macOS 签名与公证，系统可能显示安全提示。

## 项目文档

- [产品需求](docs/PRD.md)
- [实现计划](docs/PLAN.md)
- [设计说明](docs/DESIGN.md)
- [实现状态](docs/implementation-status.md)
- [架构决策](docs/adr/0001-tauri-and-model-adapters.md)
- [发布说明](docs/release.md)
