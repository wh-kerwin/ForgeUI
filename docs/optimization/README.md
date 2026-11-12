# B 端优化文档入口

当前方案日期：2026-10-22。状态：**A–E2 已按方案交付代码、契约、离线回归与文档收口**；真实模型 live 评测与桌面端到端 smoke 未运行。当前状态以 [执行记录](b2b-execution-log.md) 与 [验收报告](b2b-acceptance-report.md) 为准，下方「本次验证」为 2026-10-22 的历史记录。

用户目标是主攻 B 端，借鉴 json-render 的设计，而非复制其完整生态。推荐阅读顺序：

1. [Claude 实施计划](../plans/2026-10-22-b2b-generative-ui-implementation.md)：任务依赖、文件、测试、验收、回退和可复制的执行指令。
2. [B 端目标设计](b2b-generative-ui-design-2026-10-22.md)：产品范围、契约、运行状态、API 映射、权限与迁移。
3. [json-render 研究](../research/json-render-design-study-2026-10-22.md)：固定源码提交、核心思路和借鉴边界。
4. [ADR 0002](../adr/0002-b2b-page-contract-and-runtime.md)：为何保留领域 DSL、为何分离定义与运行数据。

实施先交付 A+B：恢复 Rust 构建，修取消/竞态/流式/空状态，统一 v1 诊断并收敛 B 端能力。之后以兼容迁移引入 v2，再完善 CRUD、局部修改和模板重绑定。

## 文档优先关系

- 本目录中的 2026-08/09 优化报告及 `docs/OPTIMIZATION.md` 是历史依据，不能当当前待办或完成证明。
- 本次用户指定的 B 端方向优先于旧 PRD 的 C 端定位；2026-10-21 新代码也改变了旧审计的部分结论。
- `docs/DESIGN.md` 的既有视觉规范继续有效；`docs/plans/2026-08-26-project-api-catalog-design.md` 的项目/API 文档归属基础继续保留。
- 用户反馈类问题的现象、根因、修复与防复发规则统一记在 [B 端优化执行记录](b2b-execution-log.md)；新增浮层、提示或诊断列表前先核对其中「前端反馈与诊断 UI 约定」，并把新反例补进同一章节。
- 新研究固定本地 HEAD 与上游 commit；实施时先核对变化。未实际测试的能力不得写“已验证”。

## 本次验证

前端80项测试通过；lint 0错误/9警告；生产构建通过并有 chunk size 警告。Rust 测试在 tokio-util 的不存在 sync feature 上阻断，已列为 A0。未执行桌面 IPC、真实模型评测；本次只交付文档。
