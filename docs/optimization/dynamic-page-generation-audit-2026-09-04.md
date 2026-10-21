# 动态页面生成系统优化复核

**日期**：2026-09-04  
**范围**：`PageSpec` 生成、流式预览、受控渲染、真实业务 API 查询与数据映射  
**关联材料**：[既有优化方案](../OPTIMIZATION.md)、[B2C 页面生成优化](./b2c-page-generation-optimization.md)

## 结论

Claude 的建议覆盖了正确的优化维度，但其对当前仓库的判断已部分过时。项目已经实现了流式预览、Zustand 状态层、多视图 DSL、Schema 驱动表单、错误文案归一和查询防抖。直接按原建议重构会产生重复工作，甚至会把现有职责划分重新混在一起。

下一轮应优先解决 **流式更新频率、请求取消、缓存失效规则、真实数据映射上限的可见性，以及组件级回归测试**。这些是当前代码中仍有明确证据、且会在真实 API 和较大数据量下影响体验的问题。

## 当前链路

```text
Prompt + 已授权 OpenAPI 上下文
  -> Workbench.requestPage()
  -> Tauri generate_page / generate_page_stream
  -> StreamingPageParser（修复 JSON、提取安全局部字段）
  -> previewPageSpec() 草稿 + GeneratedPage（操作禁用）
  -> Rust 校验后的最终 PageSpec
  -> parsePageSpec() 前端边界校验
  -> PageViewRenderer（list/chart/kanban/tabs/split）

列表查询
  -> GeneratedPage.buildListQuery()
  -> workbenchStore.query()（300ms 防抖、序号防止旧结果覆盖）
  -> execute_api Tauri command
  -> mapRealDataResponse()
  -> PageSpec rows/columns + pagination total
```

## 对 Claude 建议的复核

| 建议 | 当前状态 | 复核意见 |
| --- | --- | --- |
| `GeneratedPage` 拆分与 memo | 已部分完成 | `PageHeader`、`FilterBar`、`StatsPanel`、`MutationPanel`、`DataTableView` 已拆出；`GeneratedPage` 仍是编排层。先做 profiler 基线，再选择性 memo，不能仅因 props 对象大而包装 `React.memo`。 |
| 流式解析节流 | 尚未实现 | 应做，但不要丢弃最终片段。采用合帧/100ms 合并，将最新 `Partial<PageSpec>` 一次提交给 React。 |
| 抽 API 服务层 | 已有等价分层 | `workbenchStore` 已有 `resolveApiDocument`、`resolveRequest`、`request`、`buildApiRequest`。当前优先提取可复用请求执行器或 QueryClient，不宜新建与 store 并行的 `ApiService`。 |
| Zod/TypeBox 校验 | 不建议优先引入 | `parsePageSpec` 已为页面 DSL 做严格运行时校验，并有增强场景测试。引入第二套 schema 会增加维护面；只有需要共享 JSON Schema 或显著简化 Rust/TS 双端定义时再评估。 |
| 查询缓存与分页预取 | 未实现 | 值得做，但必须先定义鉴权、写操作、模板/文档切换后的失效规则；简单 `Map + TTL` 容易展示过期或越权数据。 |
| 数据映射 worker | 暂不需要 | 当前映射最多处理 100 行、50 列，主线程成本有限。真正问题是静默截断，而不是 CPU；先把容量限制和服务端分页表达清楚。 |
| 统一错误处理 | 已实现 | `toUserMessage` 已统一 Tauri、模型和本地解析错误。可补错误分类/重试策略，不需要另建 `UserFacingError` 才能开始。 |
| 流式快照回退 | 部分已有 | 解析器会安全提取字段，最终以 Rust 返回的规范化结果为准。更有价值的是记录“最后成功预览”并控制更新频率。 |
| 骨架屏 | 已实现 | 流式时有状态提示、禁用 fieldset 与表格 skeleton。应补组件测试和无障碍状态验证。 |
| 多视图 DSL | 已实现 | 支持 `list`、`chart`、`kanban`、`tabs`、`split`，不是仅有列表页。 |
| Schema 表单 | 已实现 | `MutationPanel`、`FieldRenderer`、`formValidation` 已使用接口字段 Schema；JSON 输入仅作为降级能力保留。 |

## 优先级与实施建议

### P0：合并流式预览更新

**证据**：`StreamingPageParser.pushModelText()` 每接收一个 chunk 都会触发 `onDelta`；`Workbench.requestPage()` 随即 `setStreamingPage(previewPageSpec(...))`。token 较碎时，整个 `GeneratedPage` 会重复渲染，且主题副作用与嵌套视图也会参与更新。

**方案**：在 `requestPage()` 或抽出的 `useStreamingPagePreview` 中保留最新 partial，用 `requestAnimationFrame` 合帧；无动画帧时设置约 80-120ms 定时器。完成、出错、取消时立即 flush 最后一次有效 partial。节流属于 UI 状态提交，不应停止 parser 累积原始文本。

**验收**：

- 1,000 个细粒度 delta 仍能得到完整最终页面。
- 草稿状态更新频率不超过显示刷新率，或稳定在每秒约 10 次。
- 完成、异常及组件卸载后没有悬挂 timer / animation frame。

### P0：为真实 API 请求加入取消语义

**证据**：store 用 `querySequence` 防止旧响应写回，这是正确的竞态保护，但此前已发出的请求仍会跑到结束。连续筛选、翻页或切换项目时，会浪费连接并可能让后端继续执行昂贵查询。

**方案**：为 Tauri `execute_api` 增加 request id 和取消 command，或让前端 API bridge 支持 `AbortSignal` 并映射到 Rust HTTP 客户端取消。仍保留 sequence guard，取消是资源优化，序号是最终一致性保护。项目/API 文档切换与组件卸载时调用同一取消入口。

**验收**：快速触发三次查询时前两次在前端和 Rust 都进入取消路径；最后一次的结果和 loading state 正确；取消不弹“请求失败”。

### P1：建立带显式失效的查询缓存

**前提**：只缓存幂等读操作；key 至少包含项目、API 文档、operation key、规范化筛选、分页、排序和当前授权上下文标识。

**失效规则**：

- 成功的 create/update/delete/batch mutation：失效对应 document + operation 的列表和详情缓存。
- 项目、API 文档启停、服务地址或授权变更：清空该上下文缓存。
- 使用模板、重新生成页面：不复用不兼容的 operation key 缓存。
- TTL 只作为兜底；页面获得焦点或用户点击加载时支持 stale-while-revalidate。

**不建议**：在没有这些规则时直接加入 Claude 示例中的全局 `Map`，它会把过期数据和权限上下文混在一起。

### P1：把数据容量从隐式截断改为可表达的产品约束

**证据**：`mapRealDataResponse` 固定取前 100 行、50 列；测试已锁定这一行为。用户会看到分页 total，却不知道前端可能丢弃了响应内其余行。

**方案**：

1. 将 `maxRows` / `maxColumns` 配置化并在 UI 显示“当前仅展示前 N 行/列”。
2. 由 OpenAPI/operation binding 表达页码和 page size，优先要求服务端分页，而不是下载后截断。
3. 对未声明分页而返回超限列表的接口给出非阻塞提示，并保留导出/查看原始响应的诊断入口。
4. 只有产品确认单页要展示数百至数千行后，才引入虚拟滚动；此时新增 `@tanstack/react-virtual` 并做可访问性验证。

### P1：补页面组件的行为测试

**证据**：解析、映射、运行时工具函数已有 Node 测试，但 CodeGraph 未找到 `GeneratedPage`、`PageViewRenderer`、查询取消/缓存行为的覆盖。关键的禁用状态、CRUD 视图收敛、分页和嵌套 tabs/split 目前主要依赖人工回归。

**方案**：引入或复用 React 测试环境后，为以下行为建立最小覆盖：

- 流式期间 `aria-busy`、fieldset 禁用、skeleton 显示，完成后恢复。
- CRUD operation 存在时强制列表视图且 mutation panel 使用正确 interaction mode。
- 查询翻页/排序的参数、旧响应不覆盖新查询。
- `tabs` 的键盘切换及 `split` 递归渲染。
- 真实数据的 ID 优先级、分页 total 和超限提示。

### P2：根据 profiler 决定 memo 边界

**证据**：`GeneratedPage` 对主题 token 已使用 `useMemo`，但 `runtimePage`、`pageOperations`、筛选参数与多条回调每次 render 都重新计算或创建；`PageViewRenderer` 也没有 memo。并不等同于“加 memo 一定更快”，因为 rows/filters 等引用会频繁变化，比较成本和闭包复杂度可能抵消收益。

**方案**：先用 React Profiler 采集三种页面：流式 dashboard、100 行 CRUD 表格、嵌套 tabs/split。仅在子树更新耗时明显且输入可保持引用稳定时：

- 用 `useMemo` 缓存 `alignListOperationWithPrompt`、`pageOperations`、operation resolution 等纯计算。
- 将稳定 handler 用 `useCallback` 传给重型子树。
- 以 `React.memo` 包裹 `DataTableView` 或图表等重型叶子，而不是机械包裹所有组件。

### P2：渐进式整理 GeneratedPage

不要按目录建议一次大搬迁。现有组件已经按 UI 职责拆开，`GeneratedPage` 主要还承担视图状态、路由状态和 operation binding。优先抽取两个无副作用 hooks：`useGeneratedPageOperations`（绑定/分页/排序参数）与 `useGeneratedPageNavigation`（create/detail/edit/delete 的 redirect 状态）。每次抽取后保持 props API 不变并补测试。

## 暂不建议排期的事项

- **全量替换为 Zod**：现有手写验证已覆盖 DSL 的细粒度兼容与修复行为；迁移收益不足以覆盖双端 schema 维护成本。
- **盲目预取相邻页**：筛选条件经常变化、部分 API 成本未知，预取可能增加请求和限流压力。先有缓存指标和可取消请求。
- **Web Worker 数据映射**：当前硬上限使处理量很小；解决服务端分页和截断可见性更直接。
- **通用重试三次**：GET 可在明确的网络瞬时错误上有限重试；POST/PUT/PATCH/DELETE 未具备幂等键时自动重试会重复写入。

## 建议执行顺序

1. 建立性能与行为基线：记录流式 delta 数、渲染次数、查询时延、取消率和缓存命中率。
2. 实施流式合帧和 API 请求取消，并加入覆盖竞态的自动化测试。
3. 将数据映射限制产品化，完善 operation binding 的分页表达。
4. 加入有失效策略的读缓存，先覆盖列表和详情 GET。
5. 根据 profile 决定 memo/hook 拆分与虚拟滚动投入。

## 变更影响与验证清单

涉及文件预计集中在 `src/features/workbench/Workbench.tsx`、`src/features/pages/streamingPageParser.ts`、`src/store/workbenchStore.ts`、`src/store/realDataMapping.ts`、Tauri 的 `business_api.rs` 及对应 tests。实施每个阶段后至少运行：

```powershell
npm test
npm run lint
npm run build
```

对 Tauri 请求取消改动，还应使用可控延迟的测试后端验证取消后不会提交旧数据、不会遗留 loading 状态，并验证 mutation 默认不自动重试。
