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

## 前端反馈与诊断 UI 约定（防复发，2026-11-10）

由「生成页双轨 UI」「旧安装包误判代码失效」「诊断提示常驻且无法关闭」三次用户反馈归纳。新增或修改任何浮层、提示、诊断列表前逐条核对，不要只修截图里那一个控件；下方 2026-11-10 记录是首个反例。

| 规则           | 要求                                                                                                                                                             | 守卫                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 终态明确       | 每个提示状态都要有进入条件和退出条件：成功类自动消失（当前 8s）、失败/API 兜底保留但可手动关闭、进行中进度提示不可关闭且必须被流程终态覆盖。                     | `tests/ui/workbenchGeneration.test.tsx` 成功/失败/8s 生命周期三项   |
| 关闭入口       | 所有非进度类浮层都要有明确关闭控件与可访问名称（如 `关闭生成诊断`、`关闭提示`）；同类浮层不得出现「一个有 X、另一个没有」。                                      | 同上，两个浮层各按 `getByRole("button", { name: ... })` 断言        |
| 信息不越期     | 诊断只展示当前终态仍有效的信息：重试/格式修复成功后不再显示已被覆盖的 error 级 issue；warning、失败原因、兜底原因保留；issue 不得在多处拼接时重复累加。          | 同上 + `finalIssues` 单一来源 + `uniqueIssues` 去重                 |
| 不重叠         | 同时存在多个浮层时要有确定的堆叠或偏移，不能共用同一 `position: fixed` 坐标互相遮挡。                                                                            | `.toast-stack` 单一 flex 容器，禁止硬编码 `bottom` 偏移             |
| 单一数据源     | 主题、组件、交互模式只能有一个来源：生成页统一局部 antd `ConfigProvider` 与 antd 控件，禁止再用 `.ant-*` 颜色覆盖或原生表单双轨。                                | `tests/generatedTheme.test.ts`、`tests/generatedStyleGuard.test.ts` |
| 先确认运行产物 | 用户反馈「改了没生效」时先区分源码、`dist`、dev server 与已安装 Tauri 包；旧安装包内嵌旧前端，须先 `npm run tauri:dev` 或重新 `npm run tauri:build` 安装再判断。 | 执行日志「运行环境诊断」条目                                        |

约定：新增成功/失败提示时必须同时补一条「能否关闭、关闭后是否残留」的 UI 用例，只改文案不改生命周期视为未完成；契约/Rust 类问题同样按「先定位运行链路、再判定是否代码缺陷」的顺序处理。

## 当前任务状态（2026-11-09 更新）

本表是当前状态入口；下方按时间保留的过程记录只代表当时状态。验证数量须与对应提交或工作区快照关联，不以早期通过结果替代最新复验。

| 任务  | 当前状态                          | 已完成内容及剩余门禁                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0    | 已完成、已合并并推送              | Rust 依赖恢复，fmt、lib tests、updater check 已在 A 阶段通过；包含于 `d34e074`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A1    | 已完成、已合并并推送              | 前后端取消契约、RAII 清理、headers/body 取消、写入 unknown 已验证；隔离真实 WebView → Tauri → Rust IPC 三项通过。                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A2    | 已完成、已合并并推送              | 请求上下文、项目/授权隔离、会话归属及 loading 所有权修复已验证，针对性复审通过。                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A3    | 已完成、已合并并推送              | 单 timer、finish/destroy 生命周期和只读草稿门禁已验证；后续B1预览UI回归超时已通过缩小DOM查询范围解决，全部零执行断言保留。                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A4    | 已完成、已合并并推送              | 空/错误/截断状态、排序清除、服务端排序及等值 defaultSort 重渲染修复已验证。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B1    | 已完成、已合并并推送（`c02cda6`） | 47 个共享 fixtures、49 项 parity/诊断测试、详细生成来源与 generate/refine 候选边界已实现。最终 Node 180/180、Rust 75/75、UI 16/16、build、Rust fmt/updater check 通过；非法 JSON 信封恢复可重试且不泄露正文，诊断使用 JSON Pointer。保留8条既有lint、7条Rust legacy dead-code及大chunk警告。                                                                                                                                                                                                                                                               |
| B2    | 已完成、已合并并推送（`b004a19`） | 能力目录、完整 operation 预算及 Rust 输入预算已实现；审查发现的字段元数据丢失已修复，按文档归属保留 bodySchemas/queryParameters，定向复审 PASS。最新完整 Node191/191、Rust79/79、UI17/17、build通过，lint0errors/8既有warnings；预算省略提示已在成功生成中展示。最后窄范围UI诊断复审 PASS with minors；已提交 `b004a19` 并快进合并、推送远程main，三个本地引用已核对一致。                                                                                                                                                                                 |
| C1    | 已完成、已合并并推送（`12bd824`） | v2 权威 Schema、共享 fixtures、生成类型与 contract:check、TS/Rust 校验器、typed DTO/版本分派、MSRV1.88 与显式 v2 provider/IPC 入口已落地。enum 长度约束 2.0/2e0 数学整数修复、strict 投影与受限 null 适配、四条 provider 路径及宿主授权离线测试通过。最终 Node 285/285、Rust 111/111、UI 17/17、build、lint 0errors/8既有warnings、Rust fmt/updater/MSRV check、contract:check 通过；默认生成与保存仍 v1。7 条 Rust legacy dead-code 已按测试专用 `cfg(test)` 收口消除；保留 8 条既有 lint warning、大 chunk 与 7 项 dev-only 中危公告（见下方收口记录）。 |
| C2    | 已完成、已合并并推送              | 有界响应 Schema 摘要、共享 OpenAPI 2.0/3.x fixtures、RFC6901 显式映射、typed recordKey 与客户端绑定面板已落地；最终 UI 30/30、Node 343/343、Rust 123/123、build/lint/fmt/updater/contract:check 通过。默认 v2 仍关闭，v1 runtime 未替换。详见下方 C2 交付记录。                                                                                                                                                                                                                                                                                            |
| C3    | 已完成、已合并并推送（`44e2466`） | 定义/运行时分离已落地：`PageRuntimeState` 状态机、展示 selectors、v1 只读 adapter、store 单一 runtime 写入点、typed 选择、stale/unbound 禁写、total 不猜测、展示来源与范围标识、数据导出与模板保存分离。最终 Node 358/358、UI 37/37、Rust 123/123、tsc/build/lint(0 errors)/fmt/updater/contract:check/Prettier/diff --check 通过。默认 v2 仍关闭。详见下方 C3 交付记录。                                                                                                                                                                                  |
| C4    | 已完成、已合并并推送（`eb311e6`） | 结构 allowlist 投影（模型/模板/会话/诊断）、Rust 保存/读取/导入导出/版本恢复再验证、`ExportDataset` DTO、v1→v2 迁移预览与跨项目重绑定、会话 prompt 策略与全入口清单已落地。最终 Node 372/372、UI 37/37、Rust 138/138、tsc/build/lint(0 errors)/fmt/updater/contract:check/Prettier/diff --check 通过。**默认 v2 写入仍关闭**：v2 runtime 与写入入口未接入，按「写入版本不能先行」留待 D 阶段；v2 envelope 导入与历史 v2 导出显式拒绝，v2 仅支持预览与 round-trip。详见下方 C4 交付记录。                                                                   |
| D1–D3 | 待实施                            | 等 C 阶段；仅最小 UI 测试设施已在 A 阶段提前建立，不代表 CRUD/refine/模板重绑定任务完成。                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E1    | 待实施，可按原计划延后            | 统计与报表语义尚未交付。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| E2    | 待实施                            | 完整交付回归、离线评测和文档收口未完成；真实模型评测不自动运行。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### C1 已开始（2026-10-30）

- B2代码 `b004a19` 已推送远程main后，开始C1实施前只读核对：v2权威schema、生成类型、TS/Rust validator与provider入口兼容。当前仅准备/接口核对，未声明C1实现或验收完成。
- 第一离线增量已落地Schema、22共享fixtures、TS类型/schema模块生成、AJV2020与Rust raw验证入口。实现者报告TS23/23、Rust共享fixtures通过、build通过，但初始红灯主要为缺模块/编译及fixture错误，未严格完成行为红测先行，不能冒称完整TDD。
- 生成脚本收口：使用os.tmpdir替代环境变量缺失时的工作区回退。实现者观察实际旧行为红后最小修复；主会话独立运行6项进程级隔离测试全部通过，覆盖成功、两个输出各自stale/missing、异常清理，均检查输出bytes/mtime不变。当前工作区contract:check通过。
- validator安全修补已交回：TS迭代输入预算/循环检测，Rust公开入口先预算与schema再私有domain，补局部key唯一性、数值区间、role-method约束及14个共享拒绝样例。主会话独立复验TS v1/v2联合90/90、Rust v2针对4/4、contract:check通过；实现者完整Rust83/83/build通过，尚待主会话全量集成复验。
- AJV8.17.1审计发现$data相关中危公告，已精确升级8.20.0（同主版本），主会话v2定向41/41、contract:check通过，npm audit0漏洞；未更改Node，原engine警告保留。
- MSRV实测：清华rustup镜像安装1.88返回404，单次指定官方源后并存安装Rust1.88.0成功，未修改默认工具链或全局镜像。主会话执行 `cargo +1.88.0-x86_64-pc-windows-msvc check --manifest-path src-tauri/Cargo.toml --locked --offline --lib --features updater --target-dir src-tauri/target-msrv-1.88` 退出0，耗时1分53秒。保留15条尚未接入v2及legacy normalize未使用警告；只证明当时快照的锁定依赖/lib/updater编译兼容，不代表1.88全测试或后续改动已验证。
- 映射增量曾通过定向TS43/43、Rust v2 4/4、contract:check，主会话全Node与1.88 locked offline updater check及build也通过；但独立语义复核不放行：类型约束为适配旧测试被错误放宽、batch.ids目标错误强制经过标量表单字段、Rust漏重复mapping目标/非batch携带batch检查。现已派修复，必须补共享反例红绿；上述绿灯不代表契约验收。
- Ruling: batch块独立描述选中raw IDs到body目标，不要求伪造标量form来源；与普通body mapping同名目标拒绝冲突。恢复已确定类型约束及enum/pattern安全规则，修正旧测试的错误期望而非放宽实现。代价：仅未发布v2定义收紧，已保存v1不受影响。
- 契约阻塞修复已独立复验：TS契约+生成检查87/87、Rust v2 4/4、contract:check通过；原审查者scoped复审三阻塞及enum/integer/pattern均ADDRESSED，无新增重要问题。保留真实红绿记录，不把先前错误测试绿灯作为放行依据。
- Rust DTO/dispatcher已落地，主会话dispatcher11/11、contract:check通过，typed Deserialize始终先共享schema/domain，raw入口2MiB限制。只读review发现enum长度约束as_u64跳过2.0/2e0，修复任务进行中，不把typed roundtrip局部绿灯视作全安全闭合。
- Ruling: strict provider投影从权威schema生成，原optional属性变required+nullable时，仅实际OpenAI非流式strict-v2返回允许按投影清单把optional null还原缺省；required/unknown/数组项null不改，分支无法无歧义匹配则拒绝。适配标repaired及安全warning，随后完整宿主校验/授权；其他provider/prompt/stream不启用反投影。代价：增加一层受限transport适配，须专门测试，绝不放宽领域Schema。
- C1仍未完成：enum数学整数审查修复及provider/IPC显式opt-in接线进行中；默认Workbench/store/renderer/persistence不改，不将离线局部通过算作C1交付。
- 默认v2仍关闭，C4全入口闭合前不启用默认生成或保存；未提前实施C2–C4。

### C1 收口与交付记录（2026-11-09）

- 接续断点复验：主会话补跑此前被 provider 编译错误阻塞的 Rust 全量测试，enum 数学整数回归 `integral_enum_length_constraints_reject_before_typed_normalization` 与 `integral_enum_length_boundaries_survive_typed_roundtrip` 通过；同期 TS 283/283、contract:check 通过。复验暴露 `GeneratedDocument` 的 wire 缺陷：内部标签被 camelCase 化为 `v1/v2` 且 `content="page"` 造成双层 `page` 嵌套。改为单层内部标签并锁定 `V1/V2`，同时修复 v1 分支 `repaired` 丢失、非 strict v2 因提前 `serde_json::from_str` 丢失共享信封修复路径的问题。
- 显式 opt-in 接线：`generate_page_versioned` / `generate_page_stream_versioned` 已注册进 `generate_handler!`（含源码守卫测试）；四条旧命令仍由 `require_legacy_version` 限定 v1，`GenerateInput.contract_version` 缺省为 1。前端 Workbench/store/renderer/persistence 未改动、未调用新命令，默认生成和保存仍 v1；未提前实施 C2–C4。
- provider 兼容清单（从权威 Schema 生成的 strict 投影，不替代宿主校验）：移除 `$schema`/`$id`/`minLength`/`maxLength`/`pattern`/`minimum`/`maximum`/`minItems`/`maxItems`；`const` → `type`+`enum`；`oneOf` → `anyOf`；原 optional 属性变 required + `anyOf[原, null]`，`additionalProperties:false` 保留。新增 `strict_projection_stays_within_declared_provider_subset` 静态检查，确认投影无关键字泄漏、无残留 optional 属性。适配后仍执行 2MiB 输入上限、共享 schema/domain、局部 key/引用/预算校验及 `allowed_operations` 授权。
- 受限反投影：仅 `contractVersion=2 && protocol=openai && structuredOutput=jsonSchema && !streaming` 启用；只删权威 Schema 声明的 optional null，required/unknown/数组项 null 保留并由宿主以 `PAGE_V2_SCHEMA_INVALID` 拒绝，view 分支无法唯一匹配时返回 `generation.strict_projection_ambiguous`。适配标 `repaired=true`、`generationSource="repaired"`（沿用 B1 四值集合）并附 `PROVIDER_OPTIONAL_NULL_ADAPTED` warning；Anthropic/prompt/流式不反投影。v2 请求使用专用结构性提示，v1 提示逐字保持不变。
- 离线本地 HTTP fixture 覆盖 OpenAI strict 适配后文档身份/授权拒绝/required null/歧义分支、Anthropic 权威 schema 路径及 optional null 拒绝、prompt 模式信封修复、流式 SSE 结果；另加 IPC 命令注册守卫与 request_id 边界测试。`contract:check` 已加入 CI 与 `npm test`，防止改 Schema 不重生成仍全绿。
- 定向复审（只读）判定 FAIL 后逐项收口：CI 生成检查缺失、第五种 `generationSource`、required/unknown null 的弱断言、strict 解析前缺 2MiB 上限、v1 不可达分叉缺完整 legacy 校验、request_id 零测试、生成产物与 Prettier 冲突。复审中「代码从未编译或测试」一项基于 target 产物 mtime 与本日志当时未更新，属误判：主会话实测命令结果见本段与状态表，且最终 Rust 111/111、MSRV check 已重新执行；保留记录以免把工具状态推断当作测试证据。
- 收口后窄范围只读核验 PASS：CI/本地生成检查、四值来源、2MiB 前置、v1 完整校验 helper、strict 触发白名单、具体错误码断言与静态兼容清单均 ADDRESSED；核验另提出两个 Minor，已补 `generate_page`/`generate_page_stream` 注册守卫，并把无效 request_id 从空诊断改为 `generation.invalid_request_id` 结构化错误并加测试。最终 Rust 111/111、Node 285/285、UI 17/17、build、lint、fmt、updater、MSRV、contract:check 均通过。
- 明确记录的非阻塞项：①`npm audit` 7 项 dev-only 中危（GHSA-g3hv-75wg-m249，`minimatch` 7.0.0–11.0.0）；`npm audit fix` 已在既有 semver 内升级 13 包，但上游 `@typescript-eslint/typescript-estree@8.72.1` 仍锁 `^10.2.2`，修复需上游发布或强制 override，本轮不冒险覆盖；CI 门禁 `--audit-level=high` 退出 0，运行时依赖不受影响。②全仓 `format:check` 仍受旧历史文档与 CRLF 工作区差异影响；C1 新增文件以 `prettier --check --end-of-line auto` 定向通过，两个生成产物与四个数值词法 fixture 精确加入 `.prettierignore`。③保留 8 条既有 lint warning 与大 chunk 警告；7 条 Rust legacy dead-code 已按「仅测试使用的归一化代码」收口消除，见下方警告清理记录。Ruling: 记录后交付，不扩大修复循环，后续依赖/格式统一收口时补覆盖。
- 未验证边界：未调用 live 模型或真实 OpenAI strict 端点，投影与真实 provider 的联调、真实模型评测留待 E2 且按边界不自动运行；v2 尚未接入 Workbench/store/renderer/persistence，C4 全入口闭合前不启用默认生成或保存。
- 已提交 `12bd824` 并快进合并本地 main、推送远程 main，`main`/`origin/main`/`optimize/b2b-workbench` 三个引用已核对一致。用户原有 OPTIMIZATION/PRD/implementation-status 修改及未跟踪设计/计划/ADR/研究文档未混入代码提交。C2 可在确认推送成功后按依赖顺序开始；本轮未提前实施 C2–C4。
- 交付后检出复验：Windows `core.autocrlf=true` 会把两个生成产物以 CRLF 检出，而生成器始终输出 LF，导致 `contract:check` 在切分支后误报 stale。已在生成器 `--check` 中仅对既有文件做 CRLF→LF 归一比较（不改写任何文件、不改变生成字节），并补一条 CRLF 检出回归，保证 `npm test`/CI 的逐内容门禁在两种行尾下都成立；stale/missing/临时目录清理断言保留。复验 `contract:check`、Node 285/285、Rust 111/111、build 通过。该修复与交付记录同样按流程快进合并并推送。
- 警告清理（用户指出）：截图中的 7 条 `warning: function ... is never used` 均来自 `page_schema.rs` 的 legacy v1 归一化辅助；全仓检索确认只有 `#[cfg(test)]` 测试模块调用，生产入口零引用，因此 `cargo check --lib` 报警而 `cargo test` 不报。已给 `normalize_page_spec` 及 6 个辅助函数加 `#[cfg(test)]`，并把仅它们使用的 `HashMap`/`HashSet` 导入一并限定为测试编译；代码与测试覆盖保留，恢复生产调用时移除 cfg 即可。`cargo check --features updater` 与 `cargo check --all-targets` 均零警告，`cargo fmt --check`、Rust 111/111、MSRV 1.88 复验通过。未触及 8 条既有 lint warning、大 chunk 与 dev-only 中危公告等其它保留项。

- 用户反馈（B 端内网）：`validate_https_or_debug_local` 原先仅 debug 构建放行 `localhost/127.0.0.1/::1`，release 包连本地测试后端都拒绝，内网明文 HTTP 的 Swagger/业务 API/模型服务全部被拦。已重命名为 `validate_url_transport` 并改为：HTTPS 一律允许；HTTP 仅放行 loopback、RFC1918（10/8、172.16/12、192.168/16）、169.254/16、IPv6 ULA `fc00::/7` 与 link-local `fe80::/10`、`localhost`/`*.localhost`/`*.local`，不再区分 debug/release；公网 HTTP、仿冒域名（`localhost.evil.com`）、URL 内嵌凭证仍拒绝。三处调用（Swagger 导入与自动发现、模型服务、业务 API）统一生效；保留 `validate_target` same-origin、operation 授权、响应长度与企业 CA 边界。新增 2 项表驱动回归（13 个放行、8 个拒绝样例），Rust 113/113、all-targets 零警告、fmt、build、lint、Node 285/285 与 MSRV 复验通过；前端两个地址 placeholder 与 README 安全边界同步。限制：内部自定义域名（如 `http://erp.corp`）无法自动判定，仍需 HTTPS；如需放行须另加显式开关，不默认放开公网明文。

- 生成页 UI 体系根治（用户反馈：页面不像使用项目 UI 框架、操作应是弹窗却散成内联块、input/select 样式错乱）：定向审计确认是**双轨体系**而非单个样式 bug —— `main.tsx` 的全局 `ConfigProvider` 固定 `darkAlgorithm` + 黄绿主色，生成页主题（如「企业蓝白」）只写 `--fg-*` 变量；`wide-layout.css` 又用 `--fg-*` 与 `!important` 覆盖 `.ant-btn/.ant-input/.ant-select/.ant-modal-*`，且多数规则限定 `.generated-page` 前缀，portal 到 body 的 Modal/Drawer 脱离该子树；`MutationPanel` inline 分支混用原生 `input/textarea/button`，自写 `Modal.tsx` 零引用；`resolveInteraction` 在 CRUD 页硬编码全 modal 并丢弃 `PageSpec.interaction`，四个 overlay 由独立 state 驱动可同时 open。修复：`themePresets.ts` 成为唯一数据源，新增 `antdTokenFor`/`isDarkThemeTokens`（按 surface 亮度选 algorithm，radius/density 映射 controlHeight），生成页包一层局部 `ConfigProvider`，portal 经 React context 继承同一 token；CSS 变量改 `useLayoutEffect` 写入并在卸载时恢复旧值；`openAction` 统一互斥入口；CRUD 保留 modal 默认值但尊重显式 interaction；inline/页头/redirect 表单全部改为 antd `Button`/`Input`/`Input.TextArea` 并补 aria-label；删除自写 `Modal.tsx`；批量清理 `wide-layout.css` 119 个选择器（`.page-modal*` 死规则、`.ant-*` 颜色覆盖）与 `generated.css` 的裸 `table/th/td`、`.table-wrap`、原生表单规则，保留纯布局规则。新增 `tests/generatedTheme.test.ts`（4 主题同色断言、明暗算法、radius/density、custom 合并）与 `tests/generatedStyleGuard.test.ts`（禁止 `.page-modal`、`.table-wrap`、`.ant-*` 颜色覆盖、生成页原生表单元素，并要求局部 ConfigProvider），防止双轨复发。复验 build、lint 0errors/8既有warnings、Node 293/293、UI 17/17、prettier 通过。边界：Workbench 全局暗色 `ConfigProvider` 保留作为主界面默认；`.view-tabs` 等自绘导航控件由独立 CSS 管理、`PageRefineBox` 待接入组件保留；`window.confirm/alert` 与图表内联色未纳入本轮。
- 说明：UI 主题改动依赖 antd CSS-in-JS 运行时注入与本地 `ConfigProvider` 的 context 继承，桌面端浅色/深色四主题的目视效果需在 Tauri 窗口中确认；自动化门禁覆盖的是 token 一致性、DOM 组件来源与样式守卫，不覆盖像素级视觉回归。

- 运行环境诊断（用户反馈 UI 根治后仍「不是弹窗、不像 antd」）：在真实浏览器中对当前源码做注入式验证 —— 生成页主按钮 `rgb(22,119,255)`/`padding 0 15px`，点击「新建」后 `.ant-modal-wrap` 为 `position: fixed`、遮罩 `rgba(0,0,0,.45)`，antd CSS-in-JS 注入 9 个组件样式标签；`tauri.conf.json` 的 `style-src 'self' 'unsafe-inline'` 未拦截注入；`dist` 的 CSS 已不含 `.page-modal`/`.ant-btn` 颜色覆盖。结论是代码生效，用户运行的是 `src-tauri/target/release/bundle/` 下 2026-08 打出的安装包，内嵌旧前端，源码/`dist`/git 更新都不会进入已安装程序，需 `npm run tauri:dev` 或重新 `npm run tauri:build` 安装。另修 antd v6 弃用的 `maskClosable` → `mask={{ closable }}`，复验 build、Node 293/293、lint 0errors。注意：Workbench 主界面为自绘 CSS（浏览器实测首页 antd 组件数为 0），只有生成结果页使用 antd，两套界面若需完全统一是独立的产品决策。
- 自检方法：在应用窗口 DevTools 执行 `getComputedStyle(document.querySelector('.ant-btn-primary')).backgroundColor`，新代码为 `rgb(22, 119, 255)`；再看 `document.querySelector('script[src]').src` 的 hash 是否与 `dist/index.html` 一致（当前 `index-Rs3MpS5E.js`），不一致即为旧构建。

- 用户反馈（2026-11-10，诊断提示常驻且不能关闭）：截图里生成成功后右下角「校验通过，页面已采用」一直挂着、没有关闭入口，下面还列着「模型响应格式无法解析，请重试生成」「PageSpec view 结构无效」等错误。三层根因叠加：①`generationStatus` 成功后不清空，渲染条件仅 `generationStatus && route === "generate"`，只有切换项目/作用域失效或下一次生成才重置；②该诊断 toast 只有内容区，关闭按钮只存在于普通 `notice` toast，两者同为 `.toast` 且共用同一 `position: fixed` 坐标，用户误以为是同一个且找不到 X；③`finalIssues = [...attemptIssues, ...result.issues]` 把重试/格式修复过程中的 error 级诊断带进成功结果，重试路径因 `result.issues` 已含 `attemptIssues` 又重复累加两次（B2 已记录的保留项），于是「成功」与「已失效错误」同屏。修复：成功（非 `apiFallback`）诊断 8 秒自动消失，失败/API 兜底保留到用户处理；所有终态增加「关闭生成诊断」X 按钮，生成中不提供关闭（进度提示）；页面采用后按 severity 过滤已被覆盖的 error issue，warning（预算提示等）保留，进行中/失败/兜底仍显示完整原因；`finalIssues` 改为直接取 `result.issues`，API 兜底结果补回 `attemptIssues`；两个 toast 叠加时诊断框上移。新增 2 项 UI 守卫：成功态可关闭且不含过期 error、失败态保留「重试生成」直到手动关闭。复验 UI 19/19、Node 293/293（含 `contract:check`）、`tsc --noEmit`、lint 0 errors/8 既有 warnings、`npm run build` 通过，`dist` 已确认包含关闭逻辑；Prettier 对两个源码文件报 warning 是 CRLF 工作区既有状态，归一后格式差异 0。边界：未执行 Tauri 打包，旧安装包仍嵌旧前端。防复发规则见本文件上方「前端反馈与诊断 UI 约定」。

- 定向复审与收口（2026-11-10，接续上条）：本批改动在提交前的窄范围只读复审判 FAIL，三项约定未闭合：①普通 `notice` toast 的关闭按钮无可访问名称、样式与诊断按钮不一致，违反「同类浮层都有 X」；②两次失败进入 `apiFallback` 时 `[...attemptIssues, ...failure.issues]` 重复累加相同 error，且该分支完全不含 `promptDiagnosticIssues`，预算 warning 丢失；③成功态 8s 自动消失、失败态不自动消失、双浮层不重叠、兜底 issue 去重均无断言。另有两个 Minor：自动消失只清 `generationStatus`，残留 `generationSource`/`generationIssues`；`bottom: 88px` 硬编码偏移对长 notice 不保证不重叠。收口：`Workbench.tsx` 用 `useCallback` 统一手动关闭与 8s 自动消失的完整状态清理；两次 `buildModelRequest` 提到外层，兜底分支补回两次预算诊断，`finalIssues` 统一经 `uniqueIssues` 去重；两个 toast 改由 `.toast-stack`（flex column + gap + `pointer-events`）单一容器堆叠，普通提示补 `关闭提示`/`type="button"`/统一 `.toast-close` 样式，删除 `.toast-with-notice`。UI 用例补 8s 成功自动消失、失败态不注册 8s timer、双浮层同容器且各自可独立关闭，并给 API 兜底用例加预算 warning 保留与 issue 去重断言；`SUCCESS_DIAGNOSTICS_MS` 与测试内 8000 常量的同步关系由测试注释锁定（改动数值会使生命周期用例失败而非静默通过，代价是常量双份，未为它新增组件文件导出以免触发 fast-refresh 警告）。最终复验：UI 22/22（定向 15/15）、Node 293/293（含 `contract:check`）、Rust 113/113、Rust fmt/updater check、`npm run build`、lint 0 errors/8 既有 warnings 通过。B2 保留项「fallback 预算 warning」至此收口，不再列为待办。边界：未执行 Tauri 打包或像素级视觉回归；旧安装包仍嵌旧前端。

### C2 交付记录（2026-11-10）

- 接续断点：上一轮诊断 UI 反馈修复已提交 `66c3305` / docs `75a725b` 并推送后才开始 C2；按计划 `docs/plans/2026-10-22-b2b-generative-ui-implementation.md` 第 185-197 行与设计 §5.1/5.2/5.3 实施。默认 v2 仍关闭，未提前实施 C3/C4，未替换 v1 runtime（`src/store/realDataMapping.ts`、`workbenchStore.query()`、生成页总数展示均保持原状）。
- 共享契约与类型：`src/types/domain.ts` 新增 `JsonPointer`、`ResponseFieldSchema`、`PointerOrigin`、`ResponseSchemaIssue`、`ResponseSchemaSummary`、`ResponseBinding`、`RecordKey`，`OpenApiSummary` 增加可选 `responseSchemas`（键为 operationId）。Rust `openapi.rs` 的 `OpenApiSummary` 增加 camelCase 同名摘要字段，两端逐字段对齐。
- Rust 有界响应摘要：为每个 operation 读取成功响应 schema（3.x 优先 `responses.200`/2xx/`default` 的 `content.application/json.schema`，2.0 取 `responses.200.schema`）；`$ref` 仅解析本地 `#/components/schemas/*` 与 `#/definitions/*`、先做 RFC6901 反转义、限跳数并检测循环、不跟随外部引用；有界遍历（深度 ≤3、属性 ≤50、节点 ≤200）产出 items/total/rowKey 指针及来源（schema/inferred/unresolved）、item 字段类型与结构化 issue（code+message，不含响应数据）；`__proto__`/`prototype`/`constructor` 大小写不敏感过滤；`x-primary-key` 优先于名称启发式。新增 `contracts/fixtures/openapi/` 的 3 个 OpenAPI 2.0/3.x 样例与 `manifest.json`（4 个 case：envelope、根数组、坏 envelope、空列表 total=0），Rust 表驱动测试与 TS 测试消费同一 manifest。
- 前端映射内核（新模块，不接入 v1 runtime）：`data/jsonPointer.ts` 实现 RFC6901（`""` 根值、`~1`→`/` 先于 `~0`→`~`、非法 `~` 转义、数组索引无前导零、中间值类型检查、原型段拒绝、无 eval/通配符）；`data/recordKey.ts` 生成 typed identity（`string:001` 与 `number:1` 不同，0/false 有效，null/对象/空串缺失，嵌套 pointer，`pathValue` 原值 URI 编码），重复或空 ID 记稳定 code 并禁写；`data/responseMapping.ts` 按显式 `ResponseBinding` 映射：不猜 LIST_KEYS、不递归 unwrap，items 非数组即 invalid，空列表保持 empty；`total` 缺失严格 undefined（绝不拿 rows.length 猜）、0 保留、负值/字符串/空指针分别诊断或视为未提供；records 保留 raw 类型，100 行/50 字段有界截断；`confirmed=false` 仅预览且 `writable=false`；issue 只含 code/pointer/计数。
- 客户端绑定面板：`features/pages/DataBindingPanel.tsx` 按 `apiDocumentId + operationKey` 选择列表 operation（`src/features/connections/openApiOperations.ts` 新增 `responseSchemaForOperation`，只按文档 + 完整 operation key 精确匹配，避免同名 operationId 跨文档/跨路径串用），展示 items/total/rowKey 指针来源与「待确认映射」，可编辑指针/勾选字段，显式「确认绑定」后才置 `confirmed=true`，编辑后自动重置为 false；本地样本只在客户端用于预览诊断，绝不渲染原始记录值、绝不进入模型请求或 IPC；响应 Schema 诊断按 code 聚合，避免重复累加（沿用上方「前端反馈与诊断 UI 约定」）。`OpenApiPage.tsx` 以会话内 `useState` 接线，不持久化；页面明确标注本地样本预览入口与持久化需在后续任务接入。
- TDD 与共享证据：先写行为测试观察红灯再最小实现（Rust 响应摘要测试先因缺 `responseSchemas` 失败；TS 映射测试先因缺模块/缺行为断言失败；UI 面板测试先因缺组件失败）。集成期主会话另补 `tests/openApiResponseSummary.test.ts`（manifest 双端一致性、RFC6901 转义、raw 类型、文档级摘要隔离、真实 `buildModelRequest` 不含响应摘要/本地样本）、`tests/ui/dataBindingPanelIntegration.test.tsx`（不 mock `mapResponse` 的真实联动）、`tests/ui/openApiBindingHost.test.tsx`（真实 OpenApiPage 宿主：绑定操作不触发保存/授权/导入/IPC）。定向集成发现两处真实缺陷并修复：空 `totalPointer` 会把根对象当总数误报 `response.total_invalid`（映射内核改为视为未提供 + 面板清空为 undefined，补守卫）；面板 `resolveSummary` 的 operationId 兜底可能串用同文档同名摘要（改为共享精确解析）。
- 定向只读复审：PASS with minors，两项高优先级缺口已收口 —— ①原本对 `buildOpenApiContext`（无生产调用者）的「不入模型」断言无效，改测真实 `buildModelRequest` 序列化输出不含 `responseSchemas`/指针/样本；②缺真实宿主接线用例，补 `openApiBindingHost.test.tsx` 并断言所有持久化/授权/导入回调与 `invoke` 均未被调用。中优先级收口：样本预览文案改为仅在确有 sample 时渲染（生产入口未接入即不宣称能力）；响应 Schema 诊断按 code 聚合去重并补 UI 守卫；删除 `collectRecordKeys` 不可达的 issue 截断分支并修正名不副实的测试名/断言；删除恒真的 IPC 断言；共享 manifest 补空列表 total=0 case。低优先级收口：Rust 危险属性过滤改大小写不敏感、3.x 成功响应优先 `application/json`、补大小写变体回归。
- 明确保留项（非阻塞，不扩大修复循环）：①绑定配置尚未持久化、切换文档/项目后 confirmed 未重置，属 C3 context 隔离与 C4 持久化范围；②生产环境尚无本地样本录入入口（`DataBindingPanel` 的 `sample` 能力与不泄露原始值已由测试覆盖），接入时须保持「只客户端、不入模型/IPC」；③Rust `$ref` 跳数上限、节点上限、`default` 响应降级与 3.x 响应级 `$ref` 的专项红绿用例尚未补齐；④嵌套 ID 的共享 fixture parity case 尚未加入 manifest（单侧 `recordKey`/`responseMapping` 测试已覆盖）；⑤v1 runtime 的总数展示仍按既有行为，C3 才替换为显式映射。Ruling: 记录后交付，C2 验收「映射结果确定、保留 raw 类型、不确定只预览不自动启用写入」已由上述门禁覆盖。
- 最终验证：UI 30/30（新增 8 项）、Node 343/343（含 `contract:check`）、Rust 123/123、Rust fmt / `cargo check --features updater`、`npm run build`、lint 0 errors/8 既有 warnings、定向 `prettier --check --end-of-line auto` 通过。未调用 live 模型、未执行 Tauri 打包或像素级视觉回归；旧安装包仍嵌旧前端。用户原有 DESIGN/OPTIMIZATION/PRD/implementation-status 修改、`src/route.css` 删除 `.route-panel` 的 3 行、`src-tauri/Cargo.toml` 空内容改动与未跟踪设计/计划/ADR/研究/`.claude` 文档均未混入代码提交。

### B2 验证与交付记录（2026-10-30）

- 主会话最终验证：Node191/191、Rust79/79、UI17/17、build通过；lint0errors/8既有warnings。Rust fmt/updater已验证；保留旧normalize的7条dead_code与大chunk警告。测试均离线或本地fixture，未调用live模型。
- 审查修复：保留operation全部roles，统计操作不再因首role为list误拒；Rust增加最终user消息合计预算；恢复各文档operation的bodySchemas/queryParameters并与tuple一起按完整块预算，避免同名schema串用。该Important定向复审PASS。
- 预算提示由本地固定诊断映射为限长warning，正常生成展示已由真实Workbench UI测试覆盖；窄范围复审PASS with minors，无新增过期回写、泄露或重复模型调用。
- 明确保留的非阻塞项：重试成功可能重复展示首次失败issues；两次失败进入API fallback时预算warning未完整保留。Ruling: 本轮记录后交付、不再扩大修复循环 — 不影响授权、重试次数、有效页面保留 — 代价是部分诊断重复/不完整，后续业务体验收口时补覆盖。（2026-11-10 已收口：前一项「重复展示」由 `finalIssues = result.issues` 与成功态 error 过滤解决；后一项「fallback 预算 warning」由两次请求诊断补回与 `uniqueIssues` 去重解决，见上方「定向复审与收口」记录。）
- 原用户PRD/OPTIMIZATION/implementation-status修改、未跟踪设计/研究文档不混入；默认v2仍关闭。提交推送确认后再开始C1。

### 提交与恢复断点

- A 阶段：`d34e074` 已合并本地 `main`，由用户推送；2026-10-26 已核实远程跟踪引用 `origin/main` 包含该提交。
- B1：已交付 `c02cda6` 并推送远程，当前返回 `optimize/b2b-workbench` 准备B2；用户原有 PRD/OPTIMIZATION/implementation-status 修改继续独立保留。
- 已恢复核对上次中断改动：非法 JSON 信封可重试及 JSON Pointer 修复已在磁盘，新的只读核验确认正确，provider针对20/20、candidate3/3通过。
- 预览 UI 测试将全页重复 role 扫描缩小到实际 header/fieldset/table/首行区域，仍使用真实组件/userEvent，保留全部零执行断言，未提高30秒超时、未跳过测试。主会话完整UI16/16通过。
- B1 已完成验证、审查、提交并推送：提交 `c02cda6`，已快进合并本地 `main`，远程 `origin/main` 已核对同一提交。包含共享fixtures、TS/Rust详细诊断、生成来源、候选绑定边界和UI门禁。
- 2026-11-10 诊断 UI 反馈修复（生成诊断生命周期、双浮层堆叠、API 兜底 warning 去重）已复审收口，代码提交 `66c3305`，本执行记录另作 docs 提交。工作区 `src/route.css` 删除 `.route-panel` 的 3 行与 `src-tauri/Cargo.toml` 的空内容改动与本次反馈无关且日志未记录，按「不混入未确认改动」保留在工作区、未纳入提交；用户原有 DESIGN/OPTIMIZATION/PRD/implementation-status 修改与未跟踪设计/计划/ADR/研究文档同样未混入。默认 v2 仍关闭，C2 在该提交时点尚未实施（随后按上方 C2 交付记录完成）。
- C2 已完成验证、复审收口与提交：代码 `2ff3fbd`（18 文件、3142 行新增），本执行记录另作 docs 提交；按流程快进合并本地 `main` 并推送远程，推送后核对 `main`/`origin/main`/`optimize/b2b-workbench` 三个引用一致。C2 未替换 v1 runtime、未启用默认 v2，C3–C4 待实施；保留项见上方 C2 交付记录。用户原有文档修改、`src/route.css`、`src-tauri/Cargo.toml` 及未跟踪设计/计划/ADR/研究/`.claude` 文档仍未混入。

### C3 交付记录（2026-11-10）

- 接续断点：C2 代码 `2ff3fbd` / docs `9e239c9` 已提交、快进合并并推送后才开始 C3；依据计划 `docs/plans/2026-10-22-b2b-generative-ui-implementation.md` 第 199-211 行与设计 §5.2/5.3。默认 v2 仍关闭，未启用生成或保存，C4 未开始。子代理因网络解析失败（`ENOTFOUND copilot.tencent.com`）无产出，改为主会话直接实现，未把工具失败当成代码结果。
- 运行时契约：新增 `src/features/pages/runtime/pageRuntimeState.ts`（idle/loading/success/empty/error/cancelled 状态机、`beginQuery`/`applyQueryResult`/`applyQueryFailure`/`applyQueryUnbound`/`applyQueryCancelled`/`clearRuntime`、100 行与 50 列上限、typed `selectedRowKeys`、`stale`/`unbound` 与写入门禁），以及 `runtimeSelectors.ts`（展示列/单元格格式化/展示行、总数为 `undefined` 时不猜测、带 `scope` 的 `DisplayStat`、范围标签、去重诊断、`queryMeta` 兼容投影、只读 v1 adapter）。`records` 保留 raw number/boolean/object，仅 selector 层格式化为 `string[][]`。
- Store 收口：`workbenchStore.ts` 以 `runtime` 为唯一数据写入点，`commitRuntime()` 同步写入 `queryMeta` 兼容投影；`query()` 只更新 runtime、不再写 `state.page`；`setPage()` 用 v1 adapter 只读定义样例；`configureApi`/`setExecutionMode`/request scope 切换清空 runtime；resolve 失败走 unbound、传输失败默认保留旧数据并显式 `stale=true`、取消走 `cancelled`。A2 的 `snapshot()`、`sequence`、`revision`、`busySequence`、`detailSequence`、`activeQueryRequestId`、debounce 与 `cancelBusinessQuery` 原样保留。`realDataMapping.ts` 新增 `mapRealDataRecords()` 提供 raw 记录，既有 `mapRealDataResponse()` 返回形状不变。
- UI 接线：`useGeneratedPageActions` 暴露 runtime 与 actions，`Workbench`/`GeneratedWorkbenchView` 透传到 `GeneratedPage`。`GeneratedPage` 的表格列、列元数据、行、统计、选择身份、批量 ID、诊断、写入门禁与分页总数全部来自 selectors；本地展示副本用 `sameRows()` 内容比较，避免仅因 selection/controls 更新而重置选择与本地编辑；选择以 typed keys 为单一来源（真实 runtime 由 store 拥有，v1 调用者保留本地 state）。状态区由 runtime 终态派生并按 code 去重，诊断列表有可访问关闭按钮且关闭签名含 `area/code/message`，新终态自动重新展示（遵守防复发约定）。接口未提供 total 时不渲染伪造的「共 0 条」，改为「仅按已加载结果翻页」的上一页/下一页；`PageHeader`/`PageExportActions` 的数据导出使用展示值、模板保存仍 `JSON.stringify(page)` 纯定义；`StatsPanel`/`StatChart` 展示范围标识与局部双语诊断，非法指标值只影响图表区域；`MutationPanel` 改用运行时展示列构造行记录与行 ID。
- 实现差异（相对计划文件清单）：`PageViewRenderer.tsx`、`DataTable.tsx`、`pageRuntime.ts` 未改动。这些模块只接收 props 中的展示数据，并不直接读取 `page.rows`；直接消费者已在 `GeneratedPage` 与 `PageExportActions` 两层收口，避免为兼容把真实数据重新塞进持久化定义。
- 回归守卫：`tests/pageRuntimeState.test.ts`（状态机、raw 保留、冻结定义、total/截断、stale/unbound 禁写、context 清理、typed 选择、统计范围、`queryMeta` 兼容形状）；`tests/workbenchRequests.test.ts` 改用 runtime 展示行并新增冻结定义红绿；`tests/ui/workbenchGeneration.test.tsx` 两处旧 `page?.rows` 断言改为 `selectDisplayRows` 并补「定义仍为空」断言；`tests/ui/pageReliability.test.tsx` 新增 7 项 C3 UI 守卫（冻结定义、stale 禁写、无伪造总数与诊断可关闭/不越期、typed 选择、统计范围、模板纯定义、identity 诊断只影响行写入）。新守卫曾因真实 AntD + `userEvent` 多次点击触发 30s 超时，改用同步 `fireEvent.click` 与 redirect create 的可观察副作用，未提高超时、未删断言、未跳过用例。
- 定向只读复审与收口：PASS with minors，三项已修复并复验。①新建按钮被 `rowWritesDisabled` 过度禁用（重复 ID 时不应影响新建），改为只受 `writesDisabled` 约束；②诊断关闭签名只含 `area/code`，同 code 不同 message 时信息可能越期，签名纳入 message；③统计/图表区域诊断文案硬编码中文，改为从 `GeneratedPage` 透传 `zh` 双语显示。另修复一次 `getByText(/已过期/)` 与范围标签文案歧义、以及一次 `findByRole` 依赖 antd Modal 内部渲染的不稳定断言。
- 最终门禁快照（本轮代码提交前）：`npm test` Node 358/358；`npm run test:ui` 37/37（5 文件）；`tsc -b --noEmit` 通过；`npm run build` 通过（JS 1,529.63 kB / gzip 482.04 kB，大 chunk 警告保留）；`npm run lint` 0 errors / 8 条既有 warnings；`npm run contract:check` 通过；Rust `cargo fmt -- --check`、`cargo test --lib` 123/123、`cargo check --features updater` 通过（C3 未改 Rust，按阶段门禁复验）；本轮 18 个文件 Prettier 定向 `--check` 与 `git diff --check` 通过。jsdom 下 antd `Input.TextArea autoSize` 的 `NaN height` 与 Drawer `width` 弃用告警为既有噪音，不影响断言，未通过放宽测试消除。
- 提交与边界：代码 `44e2466`（18 文件、1700 行新增），本执行记录另作 docs 提交；按既定授权快进合并本地 `main` 并推送远程，推送后核对 `main`/`origin/main`/`optimize/b2b-workbench` 三个引用一致。用户原有 `docs/DESIGN.md`、`docs/OPTIMIZATION.md`、`docs/PRD.md`、`docs/implementation-status.md`、`src/route.css`、`src-tauri/Cargo.toml` 修改，以及未跟踪的 `.claude/`、设计/计划/ADR/研究文档均未混入提交。默认 v2 仍关闭；C4 待用户确认后再开始。

### C4 交付记录（2026-11-11）

- 接续断点：C3 代码 `44e2466` / docs `c126fd3`、README 拆分 `736d356`、全部剩余文档 `efce312` 均已提交、快进合并并推送后才开始 C4；依据计划 `docs/plans/2026-10-22-b2b-generative-ui-implementation.md` 第 212-224 行与设计 §5.4。开始 C4 前工作区无用户遗留改动；`.claude/` 为工具 worktree 产物，全程未纳入。
- 结构投影（TS）：新增 `src/features/pages/contracts/pageProjections.ts`。按字段白名单**递归重建**定义，而不是复制对象再清空 `rows`；四个出口 `forModel` / `forTemplate` / `forSession` / `forDiagnostic` 分别用于模型上下文、模板与版本、生成会话、诊断。丢弃加载行、字面统计、批量 `customPayload`、草稿/样例/响应体/自定义头等可携带数据字段，以及 `apiDocumentId`、`secretRef`、`baseUrl` 等跨项目环境绑定；未知字段一律不复制，诊断只输出结构计数、稳定 code 与稳定路径。文本/数组/递归深度均有上限，超限写稳定 issue 而非静默截断。同文件导出 `ExportDataset` DTO（列标题、已加载展示值、范围标识与说明）、`csvSafe`（CSV 公式注入前缀转义）、`sessionPromptPolicy`、`DEFAULT_PAGE_CONTRACT_VERSION` / `V2_WRITE_ENABLED` / `defaultWriteVersion()` 及 9 项 `PROJECTION_ENTRYPOINTS` 清单。
- 模型与会话接线：`modelSafePageSpec.ts` 改为 `forModel`，并新增 `modelProjectionBlockingIssues()`；`PromptComposer.safeTemplateContext` 在投影丢失结构时显式抛 `template_budget`，避免「超长模板被静默缩短后通过预算」。`useWorkbenchPersistence.saveSession` 写 `forSession(page)` 与 `sessionPromptPolicy(prompt).value`（8 KiB 上限、明确用户输入可能包含敏感内容、不复制到模型上下文或诊断）；模板导出提示由无依据的绝对声明改为「仅含页面结构，不含已加载记录、字面统计、自定义载荷或凭证」。`parsePageSpec.ts`、`pageIssues.ts` 未改：C2/C3 已保证诊断文案由校验器撰写、定义不被查询结果写回。
- 数据导出：`src/lib/tauri/exports.ts` 改为传 `ExportDataset`；`app.rs` 的 `export_xlsx` 改收 `dataset`；`services/exporter.rs` 以 `deny_unknown_fields` 接收 DTO、校验 `scope` 合法、10k 行 / 100 列 / 4 KiB 单元格上限、`write_string` 保证公式按文本写入，并把范围说明写入独立「导出范围」工作表。`PageExportActions.tsx` 构造 DTO 并对 CSV 做公式防护，`PageHeader.tsx` 透传 `dataScope`，`GeneratedPage.tsx` 由 `resolvedRuntime.source` 决定 `current-page` / `definition-sample`，不按行数猜测；导出仍需用户主动触发，不绕过授权拉全量数据。
- Rust 再验证：新增 `src-tauri/src/domain/artifact_projection.rs`（allowlist 递归投影、2 MiB 输入上限、`has_payload_data`、`validate_session_prompt`、`DEFAULT_WRITE_VERSION = 1`）。`storage.rs` 新增 `safe_artifact_payload()`：投影 → 补齐 v1 DTO 必需的空 `rows` / `stats` 等结构数组 → `PageSpec` 反序列化与 `validate()` → **持久化校验过的 DTO 而非调用方字符串**。覆盖 `save_template`、`save_generation_session`、`load_templates`、`load_generation_sessions`、`load_template_versions`、`restore_template_version`、`export_template`、`import_template`；读取侧用 `sanitize_loaded_row()` 净化历史库行，`import_template_in` 在同一事务内完成，未知格式与 `forge-template-v2` 明确拒绝。`save_template_in` / `*_in` 抽出可注入事务或连接的实现供内存数据库测试。
- v1→v2 迁移：新增 `src/features/pages/contracts/migrateV1.ts`。`parseTemplateEnvelope` 支持 `forge-template-v1` 与 `forge-template-v2`，未知格式/载荷形状一律拒绝；`previewV1Migration` 丢弃 `rows`、`stats`、`customPayload` 并生成映射 issues，缺目标文档、重名操作、列表操作缺失、记录身份或列表指针未确认时**只预览不给出可用定义**，用户显式 `confirmed` 且映射完整才 `canSaveV2`；`buildV2Envelope` 与解析构成 round-trip 验收。`rebindForProject` 在预览态就清空旧 `apiDocumentId` / `secretRef` / `baseUrl`，仅在用户确认且候选的 method/path 完全匹配时写入目标项目文档 ID。C1 的显式 v2 provider / IPC 校验入口保持 opt-in，未被 C4 改写。
- 隔离临时数据库测试：`storage.rs` 的 `artifact_tests` 使用 `Connection::open_in_memory()` + 两次 `migrations::apply()`（旧库打开与迁移幂等），覆盖事务失败回滚、污染 payload 保存/导出/重新导入闭环、历史版本恢复净化、历史模板读取净化、v2 历史 payload 导出拒绝、未知格式与 v2 写入拒绝；`artifact_projection.rs` 与 `exporter.rs` 另测注入标记清除、投影幂等、安全错误不回显内容、导出上限与范围校验。测试不触碰开发者真实数据目录。
- 定向只读复审与收口：PASS with minors，六项已修复并复验。①投影丢弃 `customPayload` 后 `payloadBuilder.type: "custom"` 触发 `PageSpec batch action 无效` → TS 与 Rust 双侧归一化为 `{type:"ids"}`；②超限模板被静默截短、绕过 `template_budget` 拒绝 → 新增 `modelProjectionBlockingIssues` 显式抛错，并保留原预算守卫；③诊断 `dropped` 路径回显未知键名 → 未知字段改用稳定路径 `<parent>/*`；④v2 历史 payload 走 v1 投影会破坏 v2 结构 → `export_template_in` 在门禁关闭时显式拒绝而非静默损坏；⑤读取侧历史行未净化 → `sanitize_loaded_row()` 接入三个列表查询并补内存 DB 守卫；⑥新增 5 条 Rust dead-code 警告 → 把 `has_payload_data`、`DEFAULT_WRITE_VERSION`、`scope_note` 接到生产路径，不用 `allow` 屏蔽。另把 `tests/ui/pageReliability.test.tsx` 的模板保存断言从「保留定义样例行」改为「纯结构、`rows`/`stats` 为空、不含 loaded/sample」，`businessCapabilities` 的超大模板拒绝用例保持通过。
- **默认 v2 门禁结论（未打开）**：C4 只闭合投影、持久化、读取、导入导出、导出数据与迁移预览入口；v2 的运行时渲染、模板写入与目标项目重绑定 UI 仍属 D 阶段，且当前 `GeneratedPage` / store 仍消费 v1 `PageSpec`。按计划「全部完成才打开、写入版本不能先行」，保留 `V2_WRITE_ENABLED = false`、`DEFAULT_WRITE_VERSION = 1` / `defaultWriteVersion() = 1`；Rust 侧拒绝 `forge-template-v2` 导入与历史 v2 导出，v2 定义仅在 TS 侧预览与 envelope round-trip 中验证。C1 的显式 opt-in v2 校验入口不受影响。需在 D 阶段接入 v2 runtime 与写入入口、闭合剩余 `PROJECTION_ENTRYPOINTS` 后再统一开启，并同步更新 README 与状态表。
- 最终门禁快照（本轮代码提交前）：`npm test` Node 372/372；`npm run test:ui` 37/37（5 文件，格式化后复跑 504s）；`tsc -b --noEmit` 通过；`npm run build` 通过（JS 1,535.89 kB / gzip 484.28 kB，大 chunk 警告保留）；`npm run lint` 0 errors / 8 条既有 warnings；`npm run contract:check` 通过；Rust `cargo fmt -- --check`、`cargo test --lib` 138/138、`cargo check --features updater` 通过且无新增 warning；12 个前端改动文件 Prettier 定向 `--check` 与 `git diff --check` 通过。最后一次 Rust 读取侧净化收口后复跑 Rust 138/138 + fmt + check，前端文件在该收口后未变；jsdom 的 `NaN height` 与 Drawer `width` 弃用告警为既有噪音。
- 提交与边界：代码 `eb311e6`（17 文件、1936 行新增 / 106 行删除），本执行记录另作 docs 提交；按既定授权快进合并本地 `main` 并推送远程，推送后核对 `main`/`origin/main`/`optimize/b2b-workbench` 三个引用一致。`.claude/` 工具 worktree 产物未纳入；本轮不混入任何用户原有文档或样式改动（已在 `efce312` 全部提交）。C4 完成后下一个任务为 D 阶段，需用户确认后再开始。

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
