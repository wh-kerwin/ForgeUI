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
- 初始边界为不推送；2026-10-23 用户说明已自行推送任务A，并追加授权：后续每个任务完成测试、验证和审查后提交、按既定流程合并本地 main、推送远程，确认成功后才继续下一任务。此授权替代此前不推送约束；不强推、不部署、不调用付费模型，不修改同级 test-backend；用户原有文档修改不自动混入代码提交。

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

真实 IPC 验收准备（历史记录，后续三项取消 IPC 已通过，见当前状态及验证记录）：只读核对确认数据库路径固定在 Windows LocalApplicationData/ForgeUI，启动即进行迁移/备份；identifier、WebView profile 或 LOCALAPPDATA 环境变量不能可靠隔离。禁止直接启动默认应用验收。增加 debug 专用测试数据目录和隔离 smoke 脚本，release 数据路径不变；临时项目使用无认证的本地 HTTP fixture，不调用模型/凭证接口。此项属于 A1 真实 IPC 门禁的必要测试基础设施，尚未执行桌面验收。

## 当前任务状态（2026-10-26 更新）

本表是当前状态入口；下方按时间保留的过程记录只代表当时状态。验证数量须与对应提交或工作区快照关联，不以早期通过结果替代最新复验。

| 任务  | 当前状态                          | 已完成内容及剩余门禁                                                                                                                                                                                                                                                                                                                                                       |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0    | 已完成、已合并并推送              | Rust 依赖恢复，fmt、lib tests、updater check 已在 A 阶段通过；包含于 `d34e074`。                                                                                                                                                                                                                                                                                           |
| A1    | 已完成、已合并并推送              | 前后端取消契约、RAII 清理、headers/body 取消、写入 unknown 已验证；隔离真实 WebView → Tauri → Rust IPC 三项通过。                                                                                                                                                                                                                                                          |
| A2    | 已完成、已合并并推送              | 请求上下文、项目/授权隔离、会话归属及 loading 所有权修复已验证，针对性复审通过。                                                                                                                                                                                                                                                                                           |
| A3    | 已完成、已合并并推送              | 单 timer、finish/destroy 生命周期和只读草稿门禁已验证；后续B1预览UI回归超时已通过缩小DOM查询范围解决，全部零执行断言保留。                                                                                                                                                                                                                                                 |
| A4    | 已完成、已合并并推送              | 空/错误/截断状态、排序清除、服务端排序及等值 defaultSort 重渲染修复已验证。                                                                                                                                                                                                                                                                                                |
| B1    | 已完成、已合并并推送（`c02cda6`） | 47 个共享 fixtures、49 项 parity/诊断测试、详细生成来源与 generate/refine 候选边界已实现。最终 Node 180/180、Rust 75/75、UI 16/16、build、Rust fmt/updater check 通过；非法 JSON 信封恢复可重试且不泄露正文，诊断使用 JSON Pointer。保留8条既有lint、7条Rust legacy dead-code及大chunk警告。                                                                               |
| B2    | 已完成、已合并并推送（`b004a19`） | 能力目录、完整 operation 预算及 Rust 输入预算已实现；审查发现的字段元数据丢失已修复，按文档归属保留 bodySchemas/queryParameters，定向复审 PASS。最新完整 Node191/191、Rust79/79、UI17/17、build通过，lint0errors/8既有warnings；预算省略提示已在成功生成中展示。最后窄范围UI诊断复审 PASS with minors；已提交 `b004a19` 并快进合并、推送远程main，三个本地引用已核对一致。 |
| C1–C4 | 待实施                            | 等 B 阶段；默认 v2 保持关闭，完整入口闭合前不启用。                                                                                                                                                                                                                                                                                                                        |
| D1–D3 | 待实施                            | 等 C 阶段；仅最小 UI 测试设施已在 A 阶段提前建立，不代表 CRUD/refine/模板重绑定任务完成。                                                                                                                                                                                                                                                                                  |
| E1    | 待实施，可按原计划延后            | 统计与报表语义尚未交付。                                                                                                                                                                                                                                                                                                                                                   |
| E2    | 待实施                            | 完整交付回归、离线评测和文档收口未完成；真实模型评测不自动运行。                                                                                                                                                                                                                                                                                                           |

### C1 已开始（2026-10-30）

- B2代码 `b004a19` 已推送远程main后，开始C1实施前只读核对：v2权威schema、生成类型、TS/Rust validator与provider入口兼容。当前仅准备/接口核对，未声明C1实现或验收完成。
- 默认v2仍关闭，C4全入口闭合前不启用默认生成或保存；未提前实施C2–C4。

### B2 验证与交付记录（2026-10-30）

- 主会话最终验证：Node191/191、Rust79/79、UI17/17、build通过；lint0errors/8既有warnings。Rust fmt/updater已验证；保留旧normalize的7条dead_code与大chunk警告。测试均离线或本地fixture，未调用live模型。
- 审查修复：保留operation全部roles，统计操作不再因首role为list误拒；Rust增加最终user消息合计预算；恢复各文档operation的bodySchemas/queryParameters并与tuple一起按完整块预算，避免同名schema串用。该Important定向复审PASS。
- 预算提示由本地固定诊断映射为限长warning，正常生成展示已由真实Workbench UI测试覆盖；窄范围复审PASS with minors，无新增过期回写、泄露或重复模型调用。
- 明确保留的非阻塞项：重试成功可能重复展示首次失败issues；两次失败进入API fallback时预算warning未完整保留。Ruling: 本轮记录后交付、不再扩大修复循环 — 不影响授权、重试次数、有效页面保留 — 代价是部分诊断重复/不完整，后续业务体验收口时补覆盖。
- 原用户PRD/OPTIMIZATION/implementation-status修改、未跟踪设计/研究文档不混入；默认v2仍关闭。提交推送确认后再开始C1。

### 提交与恢复断点

- A 阶段：`d34e074` 已合并本地 `main`，由用户推送；2026-10-26 已核实远程跟踪引用 `origin/main` 包含该提交。
- B1：已交付 `c02cda6` 并推送远程，当前返回 `optimize/b2b-workbench` 准备B2；用户原有 PRD/OPTIMIZATION/implementation-status 修改继续独立保留。
- 已恢复核对上次中断改动：非法 JSON 信封可重试及 JSON Pointer 修复已在磁盘，新的只读核验确认正确，provider针对20/20、candidate3/3通过。
- 预览 UI 测试将全页重复 role 扫描缩小到实际 header/fieldset/table/首行区域，仍使用真实组件/userEvent，保留全部零执行断言，未提高30秒超时、未跳过测试。主会话完整UI16/16通过。
- B1 已完成验证、审查、提交并推送：提交 `c02cda6`，已快进合并本地 `main`，远程 `origin/main` 已核对同一提交。包含共享fixtures、TS/Rust详细诊断、生成来源、候选绑定边界和UI门禁。

## 2026-10-23 接续核对与补充覆盖（历史过程记录）

以下“尚未执行”“待接入”“未推送”等表述描述当时的执行阶段，并非当前任务状态；当前进度以顶部状态表为准。

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

- A0–A4 代码、测试与两轮针对审查已收口；本段记录 A 阶段提交时的验证快照；当前任务状态以上方表格为准。Node 128/128、默认 `test:ui` 11/11、Rust 69/69、Rust fmt/updater check、前端 build 均通过。真实 IPC headers/body取消及完成后cancel=0通过；不外推为E2完整桌面业务场景通过。
- 修复两项真实 loading 缺陷：生成自动query交接前释放generation ticket，旧finally不再清替代query；无效替代query的resolve失败提前出口清querying、并保留并行mutation的mutating状态。新增7项store deferred与4项真实Workbench集成测试；实现者观察正确红灯后修复，两项finding复审均ADDRESSED，无新重要问题。
- UI共11项（7项页面/表格、4项Workbench）；补真实defaultSort方向/字段/移除正向用例。并行执行曾发生30秒超时，串行通过，默认配置fileParallelism=false，未提高30秒时限。主会话默认命令实测11/11通过。
- 最终build通过，JS 1,507.07 kB / gzip 473.48 kB，chunk警告保留；lint 0 errors / 8既有warnings；npm audit 0漏洞。Node23 engine支持范围警告仍保留，未改系统Node。
- 最终format:check仅旧历史 `docs/optimization/dynamic-page-generation-audit-2026-09-04.md` 不合格式；按计划不改旧报告。本轮文件格式检查通过，不将全仓格式门禁写成通过。
- UI窄范围spec/quality审查PASS，loading修复scoped复审两项ADDRESSED。阶段提交仅含A代码、测试、必要依赖/检查配置及本执行记录；用户原有OPTIMIZATION/PRD/implementation-status和设计/研究文档不混入。B–E尚未实施，默认v2关闭。

- 阶段A提交 `d34e074` 已快进合并本地main，已返回 `optimize/b2b-workbench`；用户原有文档与未跟踪设计/研究文档保持独立。当时未由助手推送；用户随后自行推送，2026-10-26 已核实 `origin/main` 为该提交。

### B1 提交前收口（2026-10-26）

- 用户明确要求先提交合并再继续下一任务；沿用完成测试/审查后合并本地main并推送远程的授权。当前暂存区为空，仍待UI超时修复及生成链路审查，不将未通过门禁的状态标完成。
- 本轮主会话再次验证build、Rust fmt/updater check及Rust lib74/74通过；frontend原有8项warnings，UI诊断中的临时console额外warning须在交回前移除。旧normalize停用后的7项Rust dead_code warnings保留记录。
- 核心scoped复审：数量诊断具体path、raw version1.0/1e0两项均ADDRESSED；equals单字符串domain/schema差异不擅自改契约，legacy normalize仅测试调用不误报为生成入口漏洞。
- 两份数值词法fixture精确加入Prettier忽略：必须保留1.0/1e0，不允许格式化为1而削弱回归。其余B1提交文件定向Prettier通过；全仓另有旧历史文档与CRLF工作区格式差异，不全仓自动改写。

### B1 实施中（过程记录）

- 核心契约与共享fixtures、生成来源/UI诊断按互斥文件边界接续实施；契约部分负责TS parser/PageIssue与Rust domain/schema，生成部分负责model_provider/app/Workbench。不以已有重试/fallback布尔值替代可追溯来源，不调用真实模型。
- A阶段验证结果保持有效；B1新增接口与fixtures尚未验收，不将计划或代理进行中状态写成完成。默认v2关闭。
- B1核心契约代理已交回：43个共享fixture、45项parity/诊断测试、TS详细解析与绑定建议校验、Rust详细decode/validate已实现；代理报告Rust完整lib74/74、完整Node退出0（精确总数待主会话复核）。仅InteractionSpec新增deny_unknown_fields以对齐既有前端拒绝规则，未普遍扩大unknown策略。生成来源/UI/宿主共享授权fixture仍由生成链路代理补齐；这些不是B1整体验收证据。
- 2026-10-23 用户要求日限额到达即暂停当前任务及所有子agent，保留断点，明天再继续；已通知两个B1实现者，不自动等待恢复续跑。分类服务超时不等同日限额，不能误报已触及限额。未完成验证不提交、不推送；任务完成后按最新授权推送成功再继续下一任务。

- 2026-10-26 用户要求继续，已恢复B1；远程fetch确认origin/main为用户已推送的A提交d34e074。当前B1仍未提交或推送。
- 核心审查修复：共享fixtures现47例/parity49项；Rust数量超限issuePath与TS对齐，raw JSON version 1.0/1e0按数学整数语义接受，先观察Rust fixture失败后修复反序列化。visibleWhen.equals单字符串120/121两端domain本来都接受，未擅自收紧（provider schema差异另记）；legacy normalize调用者仅旧测试，详细生成不调用，保留兼容，不将公开函数存在误报为可达漏洞。
- generate/refine共用新增generationCandidate边界，拒绝未知版本及潜在静默改绑且不修改输入；Node3项先红后绿。详细IPC保持旧PageSpec命令兼容，生成来源model/repaired/retry/apiFallback已接线，本地HTTP fixture与跨文档host授权fixture通过，未调用live模型。
- 主会话最新完整Node180/180、Rust74/74通过，build曾通过；最新全UI连续两次15/16，失败均为既有pageReliability草稿零执行用例30秒超时，单独串行仍可复现，不能再仅归因并发。已委派定位具体耗时步骤，不提高timeout或删除安全断言。生成链路独立review进行中，B1不标完成。

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
