# B 端优化执行记录

依据：`docs/plans/2026-10-22-b2b-generative-ui-implementation.md` 与目标设计。开始日期：2026-10-22。

## 基线与边界

- HEAD：`84ff7ff`。初始分支：`main`。
- 保留用户已修改的 OPTIMIZATION、PRD、implementation-status 及尚未跟踪的设计、计划、ADR、研究文档。
- `rtk 0.42.0` 可用；报告未安装 hook，本轮显式使用 RTK，不修改用户配置。
- `rtk npm test`：80 passed，0 failed（2026-10-22）。
- `rtk npm run lint`：0 errors，9 warnings（既有 hook/React Refresh 警告）。
- `rtk npm run build`：通过；JS chunk 1,495.45 kB，gzip 469.86 kB；保留 chunk size 警告，拆包后置。
- CodeGraph MCP 与首次分支创建调用遇到自动审批服务超时；随后成功创建 `optimize/b2b-workbench` 分支，在当前工作区保留已有改动继续执行。避免把工具阻断当代码失败。
- 用户追加授权：每个阶段完成、审查和验证后提交并合并到本地 main，再实施下一阶段。子任务代理不自行提交，由主会话统一核对提交范围。
- 不推送、不部署、不调用付费模型，不修改同级 test-backend；用户原有文档修改不自动混入代码提交。

## 计划核对

| 任务/共享接口          | 核对与执行顺序                                                               |
| ---------------------- | ---------------------------------------------------------------------------- |
| A0 / A1 Rust 取消依赖  | 先恢复 feature 与直接依赖，再验证 token 生命周期，不能删除取消逻辑绕过编译。 |
| A1 / A2 workbenchStore | A1 确定 IPC 适配器；A2 再加 context guard，避免交错修改同文件。              |
| A2 / A3 Workbench      | 上下文隔离覆盖生成与流式回调；草稿投影独立于最终提交。                       |
| A3 / A4 preview 与查询 | 草稿无执行能力；空结果只影响已提交查询，不用旧数据伪装成功。                 |
| A4 / C3 数据映射       | 先修 v1 空结果和截断；v2 runtime 后续替换，不提前开启默认 v2。               |
| B1 / C1 契约           | v1 fixtures 与诊断先行；v2 原始 JSON 校验、生成类型和全入口另设门禁。        |
| B2 / C1 Prompt         | 能力目录引用契约，不复制字段 schema；v2 全入口闭合前不默认输出 v2。          |
| C1–C4 / D1–D3          | 定义、映射、runtime、持久化闭合之后再实现修改及模板重绑定。                  |
| E1 / E2                | E1 可延后，离线与 live 验收分开；无真实 IPC 证据不声称桌面验证完成。         |

执行裁定：用户已要求按现有设计实施，沿用已有方案，不另建同内容设计文档；已创建优化分支。代价：若方案存在产品假设偏差，须通过任务审查和可回退 diff 校正。

2026-10-22 调度调整：用户要求 Rust 构建期间继续其他任务，因此 A3、A4 在互不重叠的前端文件范围并行实施；A1/A2 等待对应文件释放后接入。提前执行不代表跳过阶段依赖，A 阶段仍须整体验证及真实 IPC 证据。代价：任务集成后须再跑完整回归，防止上下文/预览/查询状态交互回归。

真实 IPC 验收准备：只读核对确认数据库路径固定在 Windows LocalApplicationData/ForgeUI，启动即进行迁移/备份；identifier、WebView profile 或 LOCALAPPDATA 环境变量不能可靠隔离。禁止直接启动默认应用验收。增加 debug 专用测试数据目录和隔离 smoke 脚本，release 数据路径不变；临时项目使用无认证的本地 HTTP fixture，不调用模型/凭证接口。此项属于 A1 真实 IPC 门禁的必要测试基础设施，尚未执行桌面验收。

## 状态

| 任务  | 状态                         | 结果                                                                                                                                                                         |
| ----- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0    | 依赖修复审查通过，格式待收口 | tokio-util 改 rt、补 tokio macros；cargo test --lib 52 passed，updater check 通过。依赖版本无无关升级、lock v4 兼容最低 Rust。fmt 既有差异在 A1 中收口，未宣称完整门禁通过。 |
| A1    | Rust 实现待审查，前端待接入  | Rust RAII registry、headers/body 取消与超时、写结果 unknown 已实现；代理报告 cargo test --lib 66/66、updater check 通过。真实 IPC 未执行；前端等 A4 释放 store 接入。        |
| A2    | 部分进行中                   | 项目 workspace/persistence hooks 与 RequestContext 先实施；Workbench/store 等 A3/A4 文件释放后集成。                                                                         |
| A3    | 进行中                       | 流式单调度器、销毁/完成生命周期、只读草稿门禁及行为测试。                                                                                                                    |
| A4    | 进行中                       | 空结果、无效响应、截断边界、排序清除及行为测试。                                                                                                                             |
| B1–B2 | 待实施                       | 等待 A 阶段。                                                                                                                                                                |
| C1–C4 | 待实施                       | 默认 v2 保持关闭。                                                                                                                                                           |
| D1–D3 | 待实施                       | 等待 C 阶段。                                                                                                                                                                |
| E1–E2 | 待实施                       | 真实模型不自动运行。                                                                                                                                                         |

## 2026-10-23 接续核对与补充覆盖

- 已恢复原工作区 `optimize/b2b-workbench`，未合并、移植或删除子代理隔离 worktree。该隔离树只含已提交基线，缺少原工作区未提交的 A1–A4；其中旧顶层 `request_id` 修改不适用于当前嵌套 IPC 契约。
- 更正审查判断：mutation 省略 request ID 不会绕过 Rust 超时和 unknown 分类；`execute_registered` 在无 registry guard 时仍执行超时与 `interrupted(is_write, ...)`。不为未证实缺陷增加写入取消生命周期。排序清除回退仍待 UI 行为复现，不能作为已确认 P1；空响应显式非零 total 会被现有 `findTotal(body) ?? 0` 保留。
- 本轮只补测试覆盖，不修改生产行为：`tests/apiRequestContract.test.ts` 验证实际查询 ID 在 mutation 中剥离、unknown 后一次 invoke；`tests/workbenchRequests.test.ts` 补 POST/DELETE unknown 无自动重试/刷新，以及非空→空→非空、错误→显式重试时 rows/total/loading/error 和过滤分页参数；Rust tests 模块补无 request ID 写入在 headers/body 阶段超时、断连仍为 unknown。
- 主会话独立复测：`rtk node --loader ./scripts/typescript-test-loader.mjs --test tests/workbenchRequests.test.ts tests/apiRequestContract.test.ts`：14 passed / 0 failed；`cargo test --lib services::business_api::tests`：20 passed / 0 failed；`git diff --check` 通过。新增用例覆盖现有正确行为，无生产修复，不声称完成 red-green 缺陷修复。
- 最新完整 Rust 门禁：`cargo test --manifest-path src-tauri/Cargo.toml --lib`：69 passed / 0 failed；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `cargo check --manifest-path src-tauri/Cargo.toml --features updater` 均通过。
- 最新前端 build 通过：JS 1,506.91 kB / gzip 473.46 kB，保留 chunk warning。lint 0 errors / 18 warnings，其中原项目 8 条、`.claude/worktrees/agent-a3220511182b91328` 副本 10 条；不把副本警告算作原项目新增代码警告，也不掩盖全仓 lint 实际输出。
- 本轮补测前完整 Node suite 实测 117 passed / 0 failed；补测后完整 `rtk npm test` 被权限策略拒绝，不能将此前117项或局部14项写作最新全量通过。
- 最小 UI/IPC 测试依赖安装（Vitest、RTL、user-event、jsdom、playwright-core）被权限策略拒绝；未绕过、未安装。项目本地缺 playwright-core，因此真实 Tauri IPC smoke 未执行，A3 preview click/自动 query 与 A4 sort clear 的 UI 门禁仍待补齐。不得标 A 阶段整体验收完成；B–E 保持待实施、默认 v2 关闭。
- 未提交、未合并 main、未推送、未部署、未调用付费模型、未修改同级 test-backend。待测试依赖和执行权限可用后继续 A 门禁，再按阶段审查和既有授权提交。

### A 阶段最终验证（2026-10-23）

- A0–A4 代码、测试与两轮针对审查已收口；以本段为当前状态，上方表格及过程记录保留历史状态。Node 128/128、默认 `test:ui` 11/11、Rust 69/69、Rust fmt/updater check、前端 build 均通过。真实 IPC headers/body取消及完成后cancel=0通过；不外推为E2完整桌面业务场景通过。
- 修复两项真实 loading 缺陷：生成自动query交接前释放generation ticket，旧finally不再清替代query；无效替代query的resolve失败提前出口清querying、并保留并行mutation的mutating状态。新增7项store deferred与4项真实Workbench集成测试；实现者观察正确红灯后修复，两项finding复审均ADDRESSED，无新重要问题。
- UI共11项（7项页面/表格、4项Workbench）；补真实defaultSort方向/字段/移除正向用例。并行执行曾发生30秒超时，串行通过，默认配置fileParallelism=false，未提高30秒时限。主会话默认命令实测11/11通过。
- 最终build通过，JS 1,507.07 kB / gzip 473.48 kB，chunk警告保留；lint 0 errors / 8既有warnings；npm audit 0漏洞。Node23 engine支持范围警告仍保留，未改系统Node。
- 最终format:check仅旧历史 `docs/optimization/dynamic-page-generation-audit-2026-09-04.md` 不合格式；按计划不改旧报告。本轮文件格式检查通过，不将全仓格式门禁写成通过。
- UI窄范围spec/quality审查PASS，loading修复scoped复审两项ADDRESSED。阶段提交仅含A代码、测试、必要依赖/检查配置及本执行记录；用户原有OPTIMIZATION/PRD/implementation-status和设计/研究文档不混入。B–E尚未实施，默认v2关闭。

### UI 门禁与依赖安全收口（过程记录）

- 新增独立 `test:ui` 与 Vitest/RTL/jsdom 测试范围，Node loader 仍只运行根目录 `.test.ts`。真实 AntD/GeneratedPage 的6项 UI 用例覆盖排序清除、服务端不本地重排、清除后分页、新 rows、preview→live 不自动查询/重放动作、草稿无保存/批量/查询执行，以及 live 批量确认正向对照。
- 动态复现：仅 `defaultSort` 内容相同但对象新建时，清除排序被 effect 重置（期望原始 a/b/c，实际 c/a/b）。先观察失败，再把 DataTable effect 依赖改为 column/order 值；普通翻页原本正确，不改 GeneratedPage 以修复未证实问题。原审查“任何清除后翻页会恢复排序”结论撤回。
- 安全补丁：Vitest 4.1.12、Vite 7.3.7；更新兼容范围内 brace-expansion/source-map-js 补丁，显式补 RTL 的 DOM peer 与 Node 测试类型。首次升级遇 npm arborist `edgesOut` 内部错误；明确指定 Vite7 后使用 `--legacy-peer-deps`，未使用 force、未删除锁文件；补齐必需 peer 后 `npm ls --all --parseable` 退出0。
- 主会话实测 Vitest4 下 `rtk npm run test:ui`：6 passed / 0 failed。`npm audit --json`：0 vulnerabilities。Node23不在Vitest4/eslint-visitor-keys官方支持范围，保留 engine 警告，不升级系统 Node，不将本机通过说成官方支持。
- 依赖升级后 build 暴露隐式 Node 类型缺失、RTL 不支持 exact 选项与测试联合类型收窄问题；已显式补依赖及修正测试，尚待正在编写的 Workbench 集成测试完成后全量 build 复验。
- A 阶段集成审查发现两个 loading 所有权缺口：generation 自动查询Q1被用户Q2替代时旧generation finally可清Q2 loading；无效新查询取消旧查询后提前return可遗留querying。已交同一实现者先写deferred失败测试，再最小修复；审查未通过前不提交或合并A阶段。

### 用户授权安装后的进展

- 用户明确允许安装测试依赖后，原安装命令成功，无需修改 Claude Code 权限配置。新增并锁定 Vitest、RTL、user-event、jsdom、playwright-core；npm 报告6项漏洞和 Node 23.11.0 engine 警告，正在核查修复版本，未执行强制 audit fix，未更改系统 Node。
- 完整 `rtk npm test` 已重新运行：121 passed / 0 failed。此结果取代前述“补测后全量受权限阻塞”的当前状态，保留历史阻塞记录。
- 真实 IPC：`rtk proxy node scripts/smoke-query-cancellation.mjs --run --playwright-core <本项目绝对模块路径>` 实测退出0。新建 debug target、临时数据库和 WebView profile，未使用默认应用数据目录；headers 取消、body 取消、完成后 cancel=0 三项全部通过。证据目录：`C:\Users\goodk\AppData\Local\Temp\forge-a1-ipc-BD4gff`。日志确认 WebView → Tauri → Rust → loopback HTTP 链路通过；没有断言 UI 渲染，不等于完整桌面场景验收。
- A3/A4 直接 UI 行为测试仍在补齐；A阶段尚未整体验收，不提交/合并阶段完成状态。
- 检查范围修正：ESLint 与 Prettier 仅排除工具生成的 `.claude/worktrees/**`、`.superpowers/**`，不关闭源码规则、不删除副本。重新 lint 为0 errors / 8 warnings。全仓 format:check 剩旧历史 `dynamic-page-generation-audit-2026-09-04.md` 与正在编写的 UI 测试；未全仓自动格式化。针对本轮文件执行格式化时 `.prettierignore` 无可推断 parser，命令退出2，其余列出的目标文件已格式化；后续全仓 check 如实保留旧问题。
