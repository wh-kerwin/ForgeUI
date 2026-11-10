# B2B Generative UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> 若执行环境没有该技能，按本文逐任务执行、验证和记录即可；不要为缺少技能停工或安装未知包。用户已指定后续由 Claude 实施，本次交付仅为设计与计划。

**Goal:** 在保留 Forge UI 现有技术栈和安全边界的前提下，交付可靠的 B 端查询/CRUD/报表工作台，以及可校正、可复用、可解释的生成与模板链路。

**Architecture:** 保留领域 PageSpec 和现有 React 渲染器，增加小型业务能力目录。先修取消、流式和数据状态，再以版本化契约与 adapter 将页面定义和内存业务数据分离；Rust 始终负责最终授权、网络与持久化边界。

**Tech Stack:** React 19、TypeScript、Vite 7、Zustand 5、Ant Design 6、Recharts 3、Tauri 2、Rust、SQLite、OS keychain；保持现有 Node test suite，按需补 Vitest/React Testing Library UI 测试。

---

## 0. 执行入口与约束

工作目录：`D:\WH\AI-diy\project001 生成式业务UI客户端`。研究基线为 `84ff7ffcbf6477f4f6520da24b2ae6b782a5f9a8`。先阅读[目标设计](../optimization/b2b-generative-ui-design-2026-10-22.md)、[ADR 0002](../adr/0002-b2b-page-contract-and-runtime.md)；需要解释设计取舍时查[研究](../research/json-render-design-study-2026-10-22.md)。

执行原则：

- 这是既有项目，不运行新项目 scaffold，不安装 json-render，不替换 Ant Design，不重做视觉主题。
- 先读取本地 AGENTS.md 和适用规则。存在 `.codegraph/` 时先使用 `codegraph explore` 定位，再按需读文件。本文命令遵循当前 RTK 规则；若执行环境无 RTK，使用等价原命令并记录。
- 先记录工作区状态，保留用户已有修改；可使用独立 worktree。不得 reset/覆盖他人修改。
- 本文所有新增文件路径都是计划路径。改已有文件前核对当前实现；基线变化须记录差异，不机械重复已完成工作。
- 每项任务的顺序是：写行为回归用例 → 确认失败符合预期 → 最小实现 → 相关验证 → 更新记录。文案/文档等低风险变更不写实现镜像测试。
- 每个任务作为一个可回退提交；仅在会话授权提交时实际 commit，否则保留清晰工作区 diff，给出建议提交名。不要 push、部署或调用付费模型，除非用户明确要求。
- 记录文件使用 `docs/optimization/b2b-execution-log.md`：任务 ID、状态、改动、命令/结果、未决问题。不要改历史报告伪装成已完成。
- 不擅自修改同级 `test-backend`；测试依赖本项目 fixtures 和本地 mock HTTP server。

## 1. 当前验证基线（2026-10-22 实测）

| 检查                                                              | 结果                                                | 执行时处理                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `rtk npm test`                                                    | 80 passed，0 failed                                 | 保留现有套件；不把数量当质量证明                       |
| `rtk npm run lint`                                                | 0 errors，9 warnings                                | 记录原警告；修改涉及的 hook 时核验行为，不全局关闭规则 |
| `rtk npm run build`                                               | 通过；单个 JS bundle 约 1.50 MB，存在 chunk warning | 性能拆包后置，不阻塞 P0 正确性                         |
| `rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --lib` | 失败：tokio-util 0.7.19 无 sync feature             | A0 必须先解决，再获取真实 Rust 基线                    |
| Rust fmt/check、桌面端 IPC/E2E、真实模型评测                      | 本次未执行                                          | 不得在执行报告中写为已通过                             |

现有测试主要是 Node `.test.ts`，不是完整 UI/IPC 测试。`scripts/typescript-test-loader.mjs` 不等于 React/Tauri mock 环境。

## 2. 阶段与依赖

| 阶段              | 任务  | 依赖                      | 交付门禁                                        |
| ----------------- | ----- | ------------------------- | ----------------------------------------------- |
| A：恢复与可靠性   | A0–A4 | 先 A0；A1/A2/A3 后才能 A4 | Rust 可编译；取消/竞态/流式/空状态有行为证据    |
| B：契约与能力     | B1–B2 | A                         | v1 一致性、结构化诊断、B 端能力范围明确         |
| C：定义与数据分离 | C1–C4 | B                         | v2 全链路闭合，旧页可预览迁移，真实数据不入模板 |
| D：业务体验闭环   | D1–D3 | C                         | 稳定身份 CRUD、修改可撤销、模板可重绑定         |
| E：收口与评测     | E1–E2 | D                         | 回归矩阵通过；评测结论可复现；文档一致          |

首个可交付增量是 A+B，**不必等 v2 全部完成才能交付可靠性修复**。C 阶段期间 v2 读取/预览先接通，只有 C4 门禁通过才启用默认生成与保存。D/E 不新增通用框架。

粗估一名熟悉 TS/Rust 的工程师约 18–28 个工程日，取决于 API 文档质量与现有 Rust 构建问题；这是容量参考，不是承诺。可延后 E1 多源统计；不可省略取消、身份、安全投影与兼容门禁。

## A0. 恢复 Rust 构建并建立回归记录

**修改：** `src-tauri/Cargo.toml`、必要时 `src-tauri/Cargo.lock`。**新增：** `docs/optimization/b2b-execution-log.md`。

1. 记录 git status/HEAD、Node/npm/Rust 工具链和现有命令结果。
2. 核对锁定 tokio-util 0.7.19 的 features：CancellationToken 使用对应版本的 `rt` feature，当前 `sync` 不存在。最小修正 feature，不顺便升级全仓依赖。
3. 重新 cargo test/check，暴露后续编译错误。检查业务代码是否使用 tokio 宏/类型，缺直接依赖时显式补受支持特性，不能依赖传递依赖偶然可用。
4. 每个后续构建问题记录根因和最小修复；不得删掉取消逻辑绕过编译。
5. 执行下方 Rust 完整门禁，写入真实数量和结果。

```powershell
rtk proxy cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --lib
rtk proxy cargo check --manifest-path src-tauri/Cargo.toml --features updater
```

**验收：** 以上通过，或真实外部工具链问题有可复现输出且依赖错误已解决；工具链阻断时可以继续无依赖研究/前端用例，不能宣称 A 阶段门禁通过。建议提交：`fix: restore cancellation dependency build`。

## A1. 修复请求 ID、token 生命周期与取消

**修改：** `src/store/workbenchStore.ts`、`src/lib/tauri/storage.ts`（若共用 IPC helper）、`src-tauri/src/app.rs`、`src-tauri/src/services/business_api.rs`。
**新增测试：** `tests/apiRequestContract.test.ts`、Rust `business_api.rs` 内取消测试；必要时 `src/lib/tauri/businessApi.ts` 隔离可注入 invoke adapter。

1. 用 fake invoke 捕获 execute_api 参数，断言 ID 在 request 中；先让当前代码失败。取消顶层参数按 Tauri command 默认命名核对，不将嵌套 serde 字段与顶层 JS 参数混淆。

   ```ts
   // 目标 IPC 形状；snake_case 属于嵌套 ApiRequest 的 serde 契约。
   invoke("execute_api", { request: { ...apiRequest, request_id: requestId } });
   // 仅当 app.rs 没有指定其他 rename_all 时使用默认 camelCase。
   invoke("cancel_query", { requestId });
   ```

2. Rust 本地 HTTP fixture 分别延迟 headers、延迟 body；断言 cancel 后在测试时限内结束，不等服务器完整返回。该测试失败应来自取消未生效，而非网络地址不可达。
3. 注册非空唯一 ID；cancel 取出 token 并执行 `token.cancel()`。重复 ID 拒绝；取消不存在/已完成 ID 返回可区分的 no-op 结果。
4. 发送、响应 body 限长读取都置于取消和超时范围。采用 guard/统一清理函数覆盖成功、HTTP 错误、读取错误、超限、超时和取消；registry 不残留。
5. 不自动给 mutation 复用查询 token。写入遇到中断使用 unknown 状态，禁止自动重试。
6. 在真实 Tauri 开发运行中执行一次慢请求→取消，记录 IPC 参数与结果码，日志只含 ID/状态，不含 body/headers。

**测试矩阵：** 请求前取消、headers 前取消、body 中取消、完成后取消、重复取消、send error、超大 body、重复 ID、两个并发 ID 互不影响。建议 Rust 测试名：`cancels_while_reading_body`、`removes_request_on_every_exit`。

**验收：** 前后端 contract 测试 + Rust 测试通过，真实 IPC 至少一次成功。不能用 mock invoke 成功替代 Tauri 参数兼容验证。建议提交：`fix: complete business query cancellation lifecycle`。

## A2. 上下文快照阻止跨项目与旧请求回写

**修改：** `src/store/workbenchStore.ts`、`src/features/workbench/Workbench.tsx`、`src/features/workbench/useWorkbenchPersistence.ts`、`src/features/projects/useProjectWorkspace.ts`。
**新增：** `src/features/pages/requestContext.ts`、`tests/requestContext.test.ts`；必要时拆出可注入 store factory 测试，不在模块加载时执行 Tauri。

1. 使用 deferred promises 复现 A 项目生成/查询未结束→切 B 项目→A 最后返回。断言 B 的 page/runtime/session/loading/notice 均不被 A 修改。
2. 引入不可变 RequestContext 与 epoch；包含 project、文档及授权 revision、definition revision 和 requestId。同项目换文档、撤销授权也使旧上下文失效。
3. 在 success/catch/finally、模板列表/会话列表加载回写处都检查上下文；保存 session 显式使用发起时项目与有效提交上下文，禁止闭包切换后错存。
4. 新查询开始取消旧查询；项目/页面切换清理相关选择与表单。既有 querySequence 保留语义或被统一替代，避免两套规则相互冲突。
5. 修 refine 的文档范围：不默默 union active 文档；只用原页绑定且当前仍授权的集合，扩大范围须显式选择。

**验收：** A/B 反序完成、同项目授权撤销、旧 finally 不清新 loading、旧 error 不弹入新项目均通过。建议提交：`fix: reject stale workbench async results`。

## A3. 流式只读草稿与单调度器

**修改：** `src/features/pages/streamingPageParser.ts`、`src/features/workbench/Workbench.tsx`、`src/features/pages/GeneratedPage.tsx`、`src/features/pages/useGeneratedPageActions.ts`。
**扩展：** `tests/streamingPageParser.test.ts`。**新增：** `tests/previewCapabilities.test.ts`。

1. 注入 fake scheduler（set/clear timeout），输入连续碎片，断言一个 100ms 窗口只提交最新有效 partial 一次，之后无新输入不重复提交。
2. 删除 RAF/timer 双调度，使用一个 timer；发射前清 dirty/待发 partial，timer ID 在回调开始清空。确保回调内再收到输入不会丢失。
3. 定义 finish：取消 timer，完成最终解析；onComplete 至多一次；不以 repaired partial 替代 Rust 最终验证。destroy 之后 push/flush 不发回调。
4. preview 投影删除 operations、batchActions 和其他执行绑定；增加显式 preview mode，并在宿主 dispatcher 拦截所有 query/mutation/save。保留现有 skeleton/disabled UI。
5. 无效最终输出保留上一有效页并解释错误；fallback 有明确来源，不显示为模型已成功。

**必测：** Unicode 字符/转义分片、字符串内括号、1000 deltas、空流、解析失败、finish 前有 timer、destroy 后推进时钟、双 finish、preview batch click/自动 query。草稿缺少字段是等待态，最终缺字段才是错误。

**验收：** 不再重复渲染、无销毁后回调、任何草稿不触发执行。建议提交：`fix: bound streaming updates and disable draft actions`。

## A4. 空数据、截断与排序清除的最小修复

**修改：** `src/store/realDataMapping.ts`、`src/store/workbenchStore.ts`、`src/features/pages/DataTable.tsx`。
**扩展：** `tests/realDataMapping.test.ts`、`tests/dataTableState.test.ts`；UI 行为测试在 D1 补齐。

1. 将映射结果改成可区分 empty/mapped/invalid 的 union；`[]` 和 `{data:{items:[],total:0}}` 为成功空状态。
2. 空结果清除 rows、selection、旧 total，显示 empty；错误显示 error，不冒充零条。对仍保留旧数据的设计必须标为 stale 并禁用写操作。
3. 截断分 rows/columns；恰好 50 列 false、51 列 true；100 行 false、101 行 true。统计范围显示“当前加载结果”。
4. 清除 sorter 发送 null 给服务端；服务端排序禁用本地 comparator。先保住 v1 行为，C3 再替换 runtime。
5. 验证已有查询过滤、分页参数没有因空状态修复丢失。

**验收：** 连续非空→空、空→非空、错误→重试、sort→clear 均正确。建议提交：`fix: distinguish empty invalid and truncated query results`。

## B1. v1 契约一致性与结构化诊断

**修改：** `src/features/pages/parsePageSpec.ts`、`src-tauri/src/domain/page_spec.rs`、`src-tauri/src/domain/page_schema.rs`、`src/features/workbench/Workbench.tsx`。
**新增：** `src/features/pages/pageIssues.ts`、`contracts/fixtures/v1/*.json`、`tests/pageContractParity.test.ts`；Rust shared-fixture tests。

1. 从 Rust 当前规则提取共享 valid/invalid fixtures：缺版本按1处理、显式未知版本拒绝、列/行上限、views 深度/引用、非法 theme、跨文档操作、非法 batch payload。
2. 同一 fixture 让前端和 Rust 得到相同接受/拒绝结论。输出 PageIssue 列表；保留兼容 wrapper `parsePageSpec(): PageSpec | null`，上层逐步切换详细接口。
3. 把“安全修复”与“丢失数据的修复”分开：去 fences 可自动，重写 API/字段/身份不能静默完成。
4. 错误在 UI 显示阶段、可理解原因和重试/修复入口；不输出 raw response、凭证或真实业务 rows。
5. 统计 generationSource：model / repaired / retry / apiFallback；保留现有一次非流式结构化重试，不能无限循环付费重试。

**验收：** shared fixtures 前后端一致，未知版本不误收，fallback 可识别且上一有效页不丢失。建议提交：`feat: align page contract diagnostics across hosts`。

## B2. B 端能力目录与 Prompt 收敛

**新增：** `src/features/pages/capabilities/businessCapabilityCatalog.ts`、`tests/businessCapabilities.test.ts`。
**修改：** `src/features/workbench/PromptComposer.ts`、`src/features/workbench/promptTemplates.ts`、`src/features/workbench/modelRequest.ts`、`src/features/pages/PageViewRenderer.tsx`、`tests/promptComposer.test.ts`、`src/types/domain.ts`（仅必要类型）。

1. 定义 query/crud/report/dashboard 目录，按目标设计引用契约/roles/views/actions；不能复制字段 Schema。
2. 用目录构建默认提示与能力检查，静态 registry 关联现有 Renderer。测试所有目录项都有实现；不新增动态加载机制。
3. 默认入口去掉消费型场景；旧自定义模板仍可读取但能力限制有效。改掉 few-shot 中假 rows/metrics，使用空数据和绑定定义。
4. 意图与所选 API 不满足时明确缺什么；GET 方法不等于统计端点，不拿详情 GET 当列表。
5. prompt 超预算时按资源相关性裁剪元数据并提示；保留每个被推荐 operation 的文档归属。不要只截字符串导致 JSON/context 不完整。沿用当前预算测试并记录 provider 限制。

**验收：** 场景提示可解释、未授权动作从未进入可执行页、shop/social 不成为默认生成方向、多文档同名 operation 不混用。建议提交：`feat: constrain generation to business capabilities`。

## C1. v2 权威契约与完整入口支持

**新增：** `contracts/page-definition-v2.schema.json`、`contracts/fixtures/v2/*.json`、`scripts/generate-page-contract.mjs`、`src/types/generated/pageDefinitionV2.ts`、`src/features/pages/contracts/pageDefinition.ts`、`src-tauri/src/domain/page_definition_v2.rs`。
**修改：** `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`/锁文件、`src-tauri/src/domain/mod.rs`、`src-tauri/src/domain/page_schema.rs`、`src-tauri/src/services/model_provider.rs`。

1. 按目标设计第5节补全完整 Schema：唯一 key、primary source、fields、filters、现有视图、operations、受限 body constraints、theme。跨字段约束以领域测试实现，不能误以为 JSON Schema 自动处理。
2. 选取并锁定支持 Draft2020-12 的前端 validator 和 Rust jsonschema 库；TS 类型由 JSON Schema 生成。可以选 AJV2020 + json-schema-to-typescript，但先验证与现有 Node loader/打包环境兼容，禁止同时引入 Zod 再维护第三套 Schema。
3. 脚本增加 `contract:generate` / `contract:check`：后者在临时输出比较生成文件，不修改工作区。加入 npm/CI。Rust raw JSON 先 schema validate 再 deserialize/domain validate。
4. 实现 v1/v2 dispatcher，缺 version 只解释为 v1；未知版本明确拒绝，不强制 cast 成 v2。
5. 从同一 Schema 生成模型 provider 可接受的投影；测试 OpenAI/Anthropic/prompt 三条路径。strict 子集不能表达的限制列在 provider 兼容清单，由最终宿主补验。
6. shared fixtures 至少涵盖：根数组 pointer、带斜杠/波浪号字段、重复 keys、坏引用、上限、未知属性、非法 operation、stats literal 禁止、无限递归/过深 view 拒绝。

```powershell
rtk npm run contract:generate
rtk npm run contract:check
rtk npm test
rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --lib
```

**验收：** TS 生成可复现；前后端共用 fixtures；三个 provider 请求与最终解析均支持 v2；默认生成仍 v1/feature off，等待 C4。建议提交：`feat: add versioned business page definition contract`。

## C2. 明确 response/query/identity 映射

**修改：** `src-tauri/src/services/openapi.rs`、相关 Rust OpenApiSummary 类型、`src/types/domain.ts`、`src/features/connections/openApiOperations.ts`。
**新增：** `src/features/pages/data/responseMapping.ts`、`src/features/pages/data/recordKey.ts`、`src/features/pages/DataBindingPanel.tsx`、`tests/responseMapping.test.ts`、OpenAPI 2.0/3.x fixtures。

1. 读取代码定位 Rust summary 定义，不假设现有 fieldSchemas 就含响应字段。增加有界 response shape 摘要：对象/数组 envelope、item properties/types、明确 total/ID 候选。
2. 支持根数组和显式 itemsPointer；未映射成功时返回 issue。total 缺失为 undefined，零保留0，非法负值报诊断；不拿当前 rows.length 猜全量总数。
3. 实现 RFC6901（含 ~0/~1），拒绝访问非 JSON 值/危险原型属性；无 eval/表达式。
4. 提供客户端绑定面板：选择 list operation、items/total/rowKey、field paths；展示推断来源和待确认项。本地样本不进入模型请求。
5. recordKey 区分 raw 类型；重复/空 ID 禁用行操作并报告，路径参数使用原值编码。嵌套/自定义 ID 支持明确 pointer；不靠第一列。
6. 写测试：key 顺序变化、缺字段、null/false/0、string001 vs number1、重复 ID、嵌套 ID、多文档同名 operation、空列表、坏 envelope。

**验收：** 映射结果确定、保留 raw 类型；不确定只预览，不自动启用写入。建议提交：`feat: map API responses with explicit typed record identity`。

## C3. 分离 PageDefinition 与 PageRuntimeState

**新增：** `src/features/pages/runtime/pageRuntimeState.ts`、`src/features/pages/runtime/runtimeSelectors.ts`、`tests/pageRuntimeState.test.ts`。
**修改：** `src/store/workbenchStore.ts`、`src/store/realDataMapping.ts`、`src/features/pages/GeneratedPage.tsx`、`src/features/pages/PageViewRenderer.tsx`、`src/features/pages/DataTable.tsx`、`src/features/pages/StatChart.tsx`、`src/features/pages/StatsPanel.tsx`、`src/features/pages/pageRuntime.ts`。

1. 让 store 分开保存 definition 和 runtime。query 只更新 runtime，不覆盖 fields/labels/views。冻结定义输入做回归用例，查询后深度相等。
2. 通过 selectors 把 raw records 转成各 view 的展示数据；format 只在展示层，不改 ID、金额和布尔原值。
3. 定义 idle/loading/success/empty/error/cancelled，区分 total unknown、truncated、未绑定和 stale；失败保持旧数据显示时必须显式 stale 并禁写。
4. pagination/filter/sort/selection 归 runtime；context 改变清理，使用 A2 guard 防旧请求覆盖。
5. v1 adapter 提供现有 Renderer 所需结构，不能为了兼容再把真实 rows 塞回持久化定义。逐个替换所有直接读 page.rows 的消费者。
6. 展示来源与数据范围：待加载无统计数字，当前页聚合不写“全部订单”；记录样式错误只影响相应区域并给诊断，不静默消失。

**验收：** 查询不修改定义、raw 记录不转字符串、所有 views 都能显示正确状态、选择不依赖索引。建议提交：`refactor: separate page definition from runtime business data`。

## C4. 投影、存储、导入导出与 v1 迁移闭环

**新增：** `src/features/pages/contracts/pageProjections.ts`、`src/features/pages/contracts/migrateV1.ts`、`src-tauri/src/domain/artifact_projection.rs`、`tests/pageProjections.test.ts`、`tests/pageMigration.test.ts`。
**修改：** `src/features/pages/modelSafePageSpec.ts`、`src/features/workbench/useWorkbenchPersistence.ts`、`src/lib/tauri/storage.ts`、`src-tauri/src/repositories/storage.rs`、`src-tauri/src/repositories/migrations.rs`、`src-tauri/src/services/exporter.rs`、`src/features/pages/PageExportActions.tsx`、`src-tauri/src/app.rs`。

1. 实现 forModel/forTemplate/forSession/forDiagnostic 结构 allowlist 投影，Rust save/import/export 再验证。page.rows 清空不是唯一措施；覆盖 batch customPayload、默认值和嵌套可携带数据字段。
2. 区分数据导出与模板导出。ExportDataset DTO 包含列标题/已加载展示值和范围信息；保持用户主动触发、大小上限与 CSV 安全，不绕过授权拉全量数据。
3. v1 adapter 丢弃 loaded rows/literal stats，生成 mapping issues；保留旧模板和版本，用户确认后另存 v2。缺文档/重名操作/身份不明仅预览。
4. 继续支持 forge-template-v1 导入；v2 使用新 envelope，跨项目不沿用 document IDs/secretRef/baseUrl，先重绑定。未知格式拒绝。
5. 会话原始 prompt 增加明确保留/清理策略，不宣称用户输入天然不敏感。诊断不落 raw body 或完整 prompt。
6. 在隔离临时数据库测试：旧库打开、迁移幂等、事务失败回滚、旧模板重绑定、版本恢复、导出后重新导入、历史 payload 净化。不要使用开发者真实数据库作为测试 fixture。
7. 列清所有入口：模型 generate/refine、前端 parse、Rust validate、save/load/template version restore、session、import/export、data export。全部完成才打开 v2 默认生成与保存，写入版本不能先行。

**验收：** 注入测试敏感标记到 rows/stats/draft/customPayload/header 后，模型/模板/诊断输出不含标记；用户明确输入的 prompt 单独按策略处理。v1 可预览迁移，v2 round-trip 不丢定义，回滚不会重新激活失效授权。建议提交：`feat: migrate templates through safe structural projections`。

## D1. B 端表格、表单和动作结果闭环

**修改：** `src/features/pages/DataTable.tsx`、`src/features/pages/MutationPanel.tsx`、`src/features/pages/FieldRenderer.tsx`、`src/features/pages/formValidation.ts`、`src/features/pages/useGeneratedPageActions.ts`、`src/features/pages/pageOperations.ts`、`src/features/pages/recordIdentity.ts`。
**新增：** `vitest.config.ts`、`tests/ui/setup.ts`、`tests/ui/businessCrud.test.tsx`；`package.json` 增加独立 `test:ui`，保留原 `npm test`。

1. 安装并锁定 Vitest/RTL/jsdom 等最小 UI 测试依赖；将 Node 与 UI 测试范围隔开，避免旧 loader 执行 TSX。UI 通过可注入 businessApi adapter 模拟，不真正写服务。
2. 写同长度数据替换/排序/换页的选择测试；使用稳定 raw ID，查询/context 变更默认清空选择。没有可靠 ID 的行不能写。
3. 过滤字段来自 OpenAPI query 参数，显示名称独立。服务端排序不二次本地排序，clear 正确；本地处理注明“当前页”。保留现有列设置和虚拟化，不再装表格库。
4. 表单补常用约束，隐藏字段不序列化，readonly 不可改；unknown fields 不发出。后端字段错误回填，失败保留输入。
5. 详情/编辑/删除都用 raw ID，删除/批量显式确认；提交去重，成功刷新原查询，最后一页删空回退一次，unknown 不自动重试。
6. 保持默认 CRUD modal 行为，已有 drawer/redirect 的兼容规则用测试固定；不随意改变用户交互约定。

**验收：** 可执行 UI 测试覆盖筛选→分页→编辑→失败→重试成功→刷新、选择→换页、删空回退、重复点击仅一次、取消写入结果待核对。建议提交：`feat: complete typed business table and mutation workflows`。

## D2. 接通局部修改、diff 与撤销

**修改：** `src/features/pages/PageRefineBox.tsx`、`src/features/workbench/GeneratedWorkbenchView.tsx`、`src/features/workbench/Workbench.tsx`、`src/features/workbench/modelRequest.ts`。
**新增：** `src/features/pages/PageDefinitionDiff.tsx`、`tests/pageDefinitionDiff.test.ts`、`tests/ui/pageRefine.test.tsx`。

1. 将已有 refinePage 接到真实入口；idle/generating/previewDiff/applying/error 状态明确。
2. 请求只含原定义安全投影、用户指令和原已授权文档；变更范围扩大先显式选择，不 union active API 文档。
3. 候选完整定义通过相同校验后计算语义 diff：按稳定 field/view/operation key 比较，不把格式化 JSON 每行差异当主要体验。
4. 展示新增/移除字段、绑定/操作/权限变化；用户应用或放弃。应用保存一个可撤销的上版本，撤销时重新验证授权。
5. 只改标题/标签/列顺序不重查；改数据源清理 runtime/selection 并重新查询；失败保留当前有效页面。

**验收：** “金额改货币格式”“隐藏列”“增加筛选”的修改可预览应用撤销；“新增未授权删除”拒绝；切项目时旧修改结果丢弃且不保存。建议提交：`feat: expose bounded page refinement with reviewed diffs`。

## D3. 模板绑定与历史入口收口

**修改：** `src/features/workbench/useWorkbenchPersistence.ts`、模板相关现有 UI（先 CodeGraph 定位）、`src/features/pages/DataBindingPanel.tsx`、Rust `repositories/storage.rs`/`projects.rs`。
**新增测试：** `tests/ui/templateRebind.test.tsx`，Rust template-scope fixtures。

1. 加载/导入/恢复版本均显示绑定状态，失效文档不自动替换为同名 operation。
2. 展示跨项目候选映射：方法+路径+operation_id+字段结构；用户确认后写入目标 project/document IDs，宿主复验。
3. 模板历史只保存定义，恢复时验证当前授权；不恢复业务记录、选择和表单草稿。
4. 用测试覆盖跨项目 operation_id 相同但路径不同、文档删除/禁用、无候选、多候选、部分绑定、导出再导入。
5. 移除无依据的“任何业务数据都不包含”提示，改成与投影和 prompt 保留策略一致的具体说明。

**验收：** 错误绑定不可执行，重绑定后可查询，恢复历史不绕过当前权限。建议提交：`feat: require explicit template binding reconciliation`。

## E1. 统计与报表语义（可独立延后）

**修改：** v2 schema、`StatsPanel.tsx`、`StatChart.tsx`、response mapping、OpenAPI 摘要、能力目录。
**新增测试：** `tests/metricScope.test.ts`、对应 shared fixtures。

1. 仅增加具名统计数据源，不实现联邦查询/join。每项 metric 必须绑定具体 operation/valuePointer 或有限 currentPage 聚合。
2. 全量统计使用真实 stats endpoint，不把任意 GET 或当前100行求和标为全库。
3. 独立处理局部 loading/error/empty；部分统计失败保留明确错误区域，不吞错为0。
4. 筛选变化以声明的 query 参数传播，不存在的参数不得自行猜测发送。
5. Schema/provider/Rust/模板/迁移 fixtures 同步更新，不能只改前端。

**验收：** currentPage 与 serverAggregate 明确，缺绑定显示未绑定，截断可见。缓存、自动轮询、多源联动复杂图留待下一 ADR。建议提交：`feat: bind business metrics to explicit data scopes`。

## E2. 交付回归、模型评测与文档收口

**新增：** `tests/fixtures/b2b-generation/*.json`、`scripts/evaluate-business-generation.mjs`、`docs/optimization/b2b-acceptance-report.md`。
**修改：** README、`docs/PRD.md`、`docs/implementation-status.md`、相关 CI workflow；旧优化报告只补状态链接，不改旧结论。

1. 离线至少24例场景 fixture：查询/CRUD/报表/看板、根数组/分页 envelope、嵌套 ID、空数组、无权限、授权撤销、跨文档重名、无统计端点、坏输出、取消与切项目。固定输入和预期行为，不检查提示字符串是否“看起来包含关键词”。
2. 评测脚本默认 offline，记录 contract/绑定/业务执行模拟各层结果。真实模型单独显式 live 开关，由用户自行授权运行，不在自动测试中消费 token。
3. 建议 live 使用不少于30条代表性业务需求、每条3次，并固定模型/温度/提示版本；报告分子/分母和置信限制。首轮合法定义率、绑定正确率、操作可执行率、重试率、fallback率、延迟分别记录。
4. “模型首轮成功”分母为所有请求；repair/retry/fallback 单列，不将 fallback 算模型首轮正确。支持范围外请求评测正确拒绝率。
5. 本地桌面 smoke：两个项目、两个同名 operation 文档；生成→查询→筛选→排序→详情→新增/编辑/删除→修改→模板导入重绑定→取消慢 body→切项目。仅对隔离 mock 服务写数据。
6. 更新 PRD 为 B 端范围与真实实现状态；文档标记完成任务、延后项、已知风险和可回退版本。不要按计划存在就勾选完成。

最终门禁：

```powershell
rtk npm test
rtk npm run test:ui
rtk npm run contract:check
rtk npm run lint
rtk npm run build
rtk npm run format:check
rtk proxy cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
rtk proxy cargo test --manifest-path src-tauri/Cargo.toml --lib
rtk proxy cargo check --manifest-path src-tauri/Cargo.toml --features updater
```

全仓格式检查若存在旧问题，记录并仅格式化本轮文件，不能用全仓自动修复制造无关 diff；交付报告区分原问题与新增问题。lint 原有9条警告是基线，不代表可以增加警告。

**验收：** 安全/数据完整性回归零失败；最终门禁结果如实记录；live 未运行写“未运行”；项目可安装运行的结论必须有桌面实际验证。建议提交：`docs: record business workbench acceptance and scope`。

## 3. 必须保留的失败与回退策略

| 失败                | 行为                                              | 回退                         |
| ------------------- | ------------------------------------------------- | ---------------------------- |
| 模型最终输出无效    | 保留上一有效页面；一次结构化重试；可解释 fallback | 不提交坏定义                 |
| 请求取消/旧上下文   | 不回写页面/错误/loading/session                   | 当前有效页不变               |
| 响应映射错误        | 显示绑定诊断，禁用相关执行                        | 进入本地绑定校正             |
| 无可靠记录身份      | 可读预览，禁行写/批量                             | 用户指定 rowKey              |
| mutation 结果未知   | 标记待核对、刷新确认                              | 不自动重试                   |
| 模板/数据库迁移失败 | 事务回滚，保留旧版本/备份                         | 只读 v1 预览，不恢复失效授权 |
| v2 某入口未完成     | 不开启默认 v2 生成/保存                           | 继续 A+B 的 v1 修复版        |

## 4. 可直接交给 Claude 的指令

```text
请在 project001 生成式业务UI客户端 中执行 docs/plans/2026-10-22-b2b-generative-ui-implementation.md。
先读适用 AGENTS.md、目标设计与 ADR 0002，核对当前 HEAD/工作区。
按 A0→A1… 的依赖顺序实施；不要只改 Prompt，不要引入 json-render runtime，不要重做 UI 库。
每项先补能复现缺陷的行为测试，再实现并验证，在 b2b-execution-log.md 记录结果。
先交付 A+B；C 的全部入口闭合前不启用默认 v2；保持旧模板兼容与 Rust 最终授权。
不要修改同级 test-backend，不要自动调用付费模型、push 或部署。
如计划与最新代码冲突，先记录差异并做最小合理适配；真正需要产品决策时明确说明影响。
交付时列已完成任务、测试实测结果、未完成项及风险；不得把 mock 测试当成真实 IPC 验证。
```
